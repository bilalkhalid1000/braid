//! Handing a path to the desktop: the file manager and the terminal.
//!
//! Done here rather than through the webview's opener plugin because that
//! plugin's default permission set does not include opening a path, and
//! widening an ACL to launch a folder is more machinery than the job needs.
//! Spawning directly also means a failure is a normal error the activity log
//! can report, instead of a silently rejected promise.

use std::process::Stdio;

use tokio::process::Command;

use crate::error::{AppError, Result};

/// Convert a path to the separator the OS shell expects.
///
/// Git reports paths with forward slashes on every platform, including Windows
/// — `rev-parse --show-toplevel` returns `E:/Projects/app`. Most Windows APIs
/// accept that, but Explorer does not: handed a forward-slash path it silently
/// ignores the argument and opens the default folder instead of failing, so the
/// button appears to work while going to the wrong place.
pub fn native_path(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\")
    } else {
        path.to_string()
    }
}

/// The command that shows a folder in the system file manager.
pub fn file_manager_command(path: &str) -> (&'static str, Vec<String>) {
    let path = native_path(path);

    if cfg!(windows) {
        ("explorer.exe", vec![path])
    } else if cfg!(target_os = "macos") {
        ("open", vec![path])
    } else {
        ("xdg-open", vec![path])
    }
}

/// The directory holding a path, for either separator.
///
/// Windows hands us both: PATH entries are backslashed, and everything git
/// reports is forward-slashed.
fn parent_dir(path: &str) -> Option<&str> {
    let cut = path.rfind(|c| c == '/' || c == '\\')?;
    Some(&path[..cut])
}

/// Find a program on PATH.
fn on_path(program: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;

    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
        .map(|found| found.to_string_lossy().into_owned())
}

/// Where Git for Windows keeps its Bash launcher.
///
/// git-bash.exe is deliberately not on PATH: the installer adds `cmd`, which
/// holds git.exe, and leaves the launcher in the install root. So it is found
/// by walking up from a git.exe that *is* on PATH -- which works for a portable
/// or scoop install too, where the usual Program Files guesses would not --
/// with the standard locations after that.
pub fn git_bash_candidates(git_exe: Option<&str>, roots: &[String]) -> Vec<String> {
    let mut out = Vec::new();

    // git.exe lives in cmd/, bin/ or mingw64/bin/ depending on the install, so
    // the launcher is one, two or three levels up.
    if let Some(exe) = git_exe {
        let mut dir = parent_dir(exe);
        for _ in 0..3 {
            let Some(current) = dir else { break };
            out.push(format!("{current}/git-bash.exe"));
            dir = parent_dir(current);
        }
    }

    for root in roots {
        out.push(format!("{root}/Git/git-bash.exe"));
    }

    out
}

fn install_roots() -> Vec<String> {
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .map(|root| {
            // Git installs per-user under Local/Programs, not Local itself.
            if root.ends_with("Local") { format!("{root}/Programs") } else { root }
        })
        .collect()
}

/// The Bash launcher, or the bare name if none of the guesses exist -- letting
/// the spawn fail and be reported rather than pretending we know better.
fn git_bash() -> String {
    let candidates = git_bash_candidates(on_path("git.exe").as_deref(), &install_roots());

    candidates
        .into_iter()
        .find(|candidate| std::path::Path::new(candidate).is_file())
        // Built by joining, so it comes back with both separators in it. The
        // OS does not mind, but this path is shown in the activity log.
        .map(|found| native_path(&found))
        .unwrap_or_else(|| "git-bash.exe".to_string())
}

/// A terminal the user can pick in settings.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOption {
    /// Stored in settings. Stable across releases and across platforms.
    pub id: String,
    pub label: String,
}

fn option(id: &str, label: &str) -> TerminalOption {
    TerminalOption { id: id.into(), label: label.into() }
}

/// What to offer in settings, for this platform.
///
/// Built here rather than in the UI so the list and the launcher cannot
/// disagree: an entry the user can pick but nothing knows how to start is a
/// button that silently does nothing.
pub fn terminal_options() -> Vec<TerminalOption> {
    let mut options = vec![option("auto", "Choose automatically")];

    options.extend(if cfg!(windows) {
        vec![
            option("wt", "Windows Terminal"),
            option("powershell", "Windows PowerShell"),
            option("pwsh", "PowerShell 7"),
            option("cmd", "Command Prompt"),
            option("gitbash", "Git Bash"),
        ]
    } else if cfg!(target_os = "macos") {
        vec![option("terminal", "Terminal"), option("iterm", "iTerm2")]
    } else {
        vec![
            option("gnome-terminal", "GNOME Terminal"),
            option("konsole", "Konsole"),
            option("xfce4-terminal", "Xfce Terminal"),
            option("alacritty", "Alacritty"),
            option("kitty", "kitty"),
            option("xterm", "xterm"),
        ]
    });

    options.push(option("custom", "Custom command"));
    options
}

/// A PowerShell single-quoted string. Doubling the quote is the escape; without
/// it a directory with an apostrophe ends the string early and the rest of the
/// path is read as commands.
fn powershell_cd(native: &str) -> Vec<String> {
    vec![
        "-NoExit".into(),
        "-Command".into(),
        format!("Set-Location -LiteralPath '{}'", native.replace('\'', "''")),
    ]
}

/// How to start one named terminal at a path.
///
/// None for an id this platform does not have, which is what happens when a
/// settings file is carried to another OS.
pub fn named_terminal(id: &str, path: &str) -> Option<(String, Vec<String>)> {
    let native = native_path(path);

    let (program, args): (&str, Vec<String>) = match id {
        "wt" => ("wt.exe", vec!["-d".into(), native.clone()]),
        "powershell" => ("powershell.exe", powershell_cd(&native)),
        "pwsh" => ("pwsh.exe", powershell_cd(&native)),
        "cmd" => ("cmd.exe", vec!["/K".into(), format!("cd /d \"{native}\"")]),
        // Git Bash wants the path in its own POSIX-ish spelling, not Windows'.
        "gitbash" => {
            return Some((git_bash(), vec![format!("--cd={}", native.replace('\\', "/"))]))
        }

        "terminal" => ("open", vec!["-a".into(), "Terminal".into(), native.clone()]),
        "iterm" => ("open", vec!["-a".into(), "iTerm".into(), native.clone()]),

        "gnome-terminal" => ("gnome-terminal", vec![format!("--working-directory={native}")]),
        "konsole" => ("konsole", vec!["--workdir".into(), native.clone()]),
        "xfce4-terminal" => ("xfce4-terminal", vec![format!("--working-directory={native}")]),
        "alacritty" => ("alacritty", vec!["--working-directory".into(), native.clone()]),
        "kitty" => ("kitty", vec!["--directory".into(), native.clone()]),
        // Takes no directory flag; it inherits the working directory we spawn
        // it with, which is the same place.
        "xterm" => ("xterm", vec![]),

        _ => return None,
    };

    Some((program.to_string(), args))
}

/// Split a command line into a program and its arguments.
///
/// Quote-aware, because the interesting case is a terminal installed under
/// "C:/Program Files". Deliberately not a shell: there is no expansion, no
/// pipes and no operators, so nothing a user types in this box can turn into a
/// second command.
pub fn split_command(text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;

    for c in text.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => current.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                // An empty pair of quotes is still an argument.
                started = true;
            }
            None if c.is_whitespace() => {
                if started {
                    parts.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            None => {
                current.push(c);
                started = true;
            }
        }
    }

    if started {
        parts.push(current);
    }

    parts
}

/// A user's own command line, with {path} filled in.
///
/// The substitution happens after splitting, so a path with spaces stays one
/// argument instead of becoming several.
pub fn custom_terminal(template: &str, path: &str) -> Option<(String, Vec<String>)> {
    let native = native_path(path);
    let mut parts = split_command(template).into_iter();
    let program = parts.next()?;

    let args = parts.map(|arg| arg.replace("{path}", &native)).collect();

    Some((program.replace("{path}", &native), args))
}

/// Terminals to try when the user has not chosen one, in order of preference.
///
/// Windows Terminal is what most people have configured but it is not present
/// on every machine, so a plain console is kept as the fallback rather than
/// letting the button fail on a stock install.
pub fn terminal_commands(path: &str) -> Vec<(String, Vec<String>)> {
    let ids: &[&str] = if cfg!(windows) {
        &["wt", "powershell", "cmd"]
    } else if cfg!(target_os = "macos") {
        &["terminal"]
    } else {
        &["gnome-terminal", "konsole", "xterm"]
    };

    let mut candidates: Vec<(String, Vec<String>)> =
        ids.iter().filter_map(|id| named_terminal(id, path)).collect();

    // Debian's alternatives symlink, which points at whatever the user actually
    // installed. Last, because it has no name of its own to report.
    if cfg!(not(any(windows, target_os = "macos"))) {
        candidates.push(("x-terminal-emulator".to_string(), vec![]));
    }

    candidates
}

pub async fn open_file_manager(path: &str) -> Result<String> {
    let (program, args) = file_manager_command(path);

    // explorer.exe exits non-zero even when it succeeded, so only the spawn is
    // checked. Waiting on the status here would report a failure every time.
    spawn(program, &args, path).await?;
    Ok(format!("Opened {path}"))
}

/// Open a terminal at a path.
///
/// `choice` is the id from settings: "auto", one of `terminal_options`, or
/// "custom", in which case `custom` is the user's own command line.
///
/// A chosen terminal is tried first and the automatic list still follows it. A
/// machine that has lost the terminal it was configured with -- uninstalled,
/// renamed, or a settings file carried from another OS -- should still open
/// something rather than leaving the button dead. The message names the program
/// that actually started, so a fallback is visible in the activity log instead
/// of being a silent substitution.
/// Everything to try, in order, for a given setting.
///
/// Separate from launching so the choice can be tested: whether the terminal
/// the user picked is what actually starts is the whole question, and it is not
/// one that can be asked of a function whose only observable behaviour is that
/// a window appeared on somebody's desktop.
pub fn terminal_candidates(path: &str, choice: &str, custom: &str) -> Vec<(String, Vec<String>)> {
    let chosen = match choice {
        "custom" => custom_terminal(custom, path),
        "" | "auto" => None,
        id => named_terminal(id, path),
    };

    // A choice we can honour is the only thing tried. Falling back to another
    // terminal is indistinguishable from the setting being ignored -- which is
    // exactly how it looked when Git Bash could not be found and Windows
    // Terminal opened in its place. A failure the user can see and act on beats
    // a success that was not what they asked for.
    if let Some(chosen) = chosen {
        return vec![chosen];
    }

    // Nothing to honour: no choice made, an id this platform has never had, or
    // a custom command with nothing in it. The automatic list beats a dead
    // button here, because there is no instruction being overridden.
    terminal_commands(path)
}

fn terminal_label(id: &str) -> Option<String> {
    terminal_options()
        .into_iter()
        .find(|option| option.id == id)
        .map(|option| option.label)
}

/// Open a terminal at a path.
///
/// `choice` is the id from settings: "auto", one of `terminal_options`, or
/// "custom", in which case `custom` is the user's own command line.
pub async fn open_terminal(path: &str, choice: &str, custom: &str) -> Result<String> {
    let candidates = terminal_candidates(path, choice, custom);
    let mut tried: Vec<String> = Vec::new();

    for (program, args) in &candidates {
        match spawn(program, args, path).await {
            Ok(()) => return Ok(format!("Opened {program} in {path}")),
            Err(_) => tried.push(program.clone()),
        }
    }

    let named = terminal_label(choice).unwrap_or_else(|| choice.to_string());

    Err(AppError::Git {
        code: -1,
        stderr: match tried.as_slice() {
            [] => format!("Nothing to launch for the terminal setting {choice:?}."),
            [one] => format!(
                "{named} could not be started: {one} is not there.                  Pick a different terminal in Settings."
            ),
            many => format!("No terminal could be launched. Tried: {}.", many.join(", ")),
        },
    })
}

async fn spawn(program: &str, args: &[String], cwd: &str) -> Result<()> {
    Command::new(program)
        .args(args)
        .current_dir(native_path(cwd))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_child| ())
        .map_err(|e| AppError::Git {
            code: -1,
            stderr: format!("Could not launch {program}: {e}"),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_manager_passes_the_path_through_unquoted() {
        // The path is an argument, not a shell string, so it must not carry
        // quotes of its own — the OS gets it verbatim, spaces and all.
        let (_, args) = file_manager_command("C:/my repos/app");
        assert!(!args[0].contains('"'));
        assert!(args[0].ends_with("my repos\\app") || args[0].ends_with("my repos/app"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_uses_explorer() {
        assert_eq!(file_manager_command("C:/x").0, "explorer.exe");
    }

    #[cfg(windows)]
    #[test]
    fn explorer_gets_backslashes_not_the_forward_slashes_git_reports() {
        // Explorer silently opens the default folder when given forward
        // slashes, so this is the difference between working and looking
        // like it worked.
        let (_, args) = file_manager_command("E:/Projects/tracker");
        assert_eq!(args[0], "E:\\Projects\\tracker");
    }

    #[cfg(windows)]
    #[test]
    fn terminals_get_backslashes_too() {
        let candidates = terminal_commands("E:/Projects/tracker");
        let wt = &candidates[0];

        assert_eq!(wt.0, "wt.exe");
        assert_eq!(wt.1[1], "E:\\Projects\\tracker");
    }

    #[cfg(not(windows))]
    #[test]
    fn other_platforms_keep_the_path_as_given() {
        assert_eq!(native_path("/home/me/app"), "/home/me/app");
    }

    #[cfg(windows)]
    #[test]
    fn windows_terminal_is_tried_before_the_fallbacks() {
        let candidates = terminal_commands("C:/x");

        assert_eq!(candidates[0].0, "wt.exe");
        assert!(candidates.len() > 1, "a fallback terminal must exist");
    }

    #[cfg(windows)]
    #[test]
    fn powershell_path_is_escaped_for_a_single_quoted_string() {
        // A quote in a directory name would otherwise end the string early and
        // turn the rest of the path into commands.
        let candidates = terminal_commands("C:/it's mine");
        let powershell = candidates.iter().find(|(p, _)| *p == "powershell.exe").unwrap();

        assert!(powershell.1.last().unwrap().contains("it''s mine"));
    }

    #[test]
    fn the_chosen_terminal_is_tried_first() {
        // The bug this guards: a choice that is collected, stored and passed
        // all the way down, and then queued behind the automatic list, so the
        // setting appears to do nothing.
        for option in terminal_options() {
            if option.id == "auto" || option.id == "custom" {
                continue;
            }

            let expected = named_terminal(&option.id, "/tmp/repo").unwrap();
            let candidates = terminal_candidates("/tmp/repo", &option.id, "");

            assert_eq!(
                candidates,
                vec![expected],
                "{} was chosen but something else could start",
                option.id
            );
        }
    }

    #[test]
    fn a_custom_command_is_the_only_thing_tried() {
        let candidates = terminal_candidates("/tmp/repo", "custom", "my-term --cd {path}");

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].0, "my-term");
    }

    #[test]
    fn choosing_nothing_leaves_the_automatic_order_alone() {
        let auto = terminal_candidates("/tmp/repo", "auto", "");
        let unset = terminal_candidates("/tmp/repo", "", "");

        assert_eq!(auto, terminal_commands("/tmp/repo"));
        assert_eq!(unset, auto);
    }

    #[test]
    fn a_chosen_terminal_that_fails_is_not_quietly_replaced() {
        // The bug as reported: Git Bash was chosen, could not be started, and
        // Windows Terminal opened instead -- so the setting looked ignored.
        // Nothing else may be queued behind a choice we can honour.
        let candidates = terminal_candidates("/tmp/repo", &terminal_options()[1].id, "");

        assert_eq!(candidates.len(), 1, "a choice must not fall back to another terminal");
    }

    #[test]
    fn the_launcher_is_looked_for_next_to_the_git_that_is_on_path() {
        // git-bash.exe is not on PATH -- the installer adds cmd/, which holds
        // git.exe -- so naming it is not enough to start it.
        let found = git_bash_candidates(Some("C:/Program Files/Git/cmd/git.exe"), &[]);

        assert!(
            found.contains(&"C:/Program Files/Git/git-bash.exe".to_string()),
            "walking up from git.exe should reach the install root: {found:?}"
        );
    }

    #[test]
    fn the_launcher_is_found_from_a_deeper_git_too() {
        // where.exe reports this one first on a normal install.
        let found = git_bash_candidates(Some("C:/Program Files/Git/mingw64/bin/git.exe"), &[]);

        assert!(found.contains(&"C:/Program Files/Git/git-bash.exe".to_string()));
    }

    #[cfg(windows)]
    #[test]
    fn git_bash_resolves_to_something_that_exists() {
        // The end of the chain, on a real machine: whatever we would hand to
        // the OS has to be a file, or the button fails the way it did.
        let (program, _) = named_terminal("gitbash", "C:/tmp").expect("Windows offers Git Bash");

        eprintln!("git bash resolved to: {program}");

        if on_path("git.exe").is_some() {
            assert!(
                std::path::Path::new(&program).is_file(),
                "resolved to {program}, which is not there"
            );
        }
    }

    #[test]
    fn the_standard_locations_are_tried_when_git_is_not_on_path() {
        let found = git_bash_candidates(None, &["C:/Program Files".to_string()]);

        assert_eq!(found, ["C:/Program Files/Git/git-bash.exe"]);
    }

    #[test]
    fn a_directory_is_found_through_either_separator() {
        assert_eq!(parent_dir("C:/a/b"), Some("C:/a"));
        assert_eq!(parent_dir(concat!("C:", "\\", "a", "\\", "b")), Some(concat!("C:", "\\", "a")));
        assert_eq!(parent_dir("git.exe"), None);
    }

    #[test]
    fn a_choice_this_platform_does_not_have_still_opens_something() {
        let candidates = terminal_candidates("/tmp/repo", "no-such-terminal", "");

        assert!(!candidates.is_empty(), "the button must not go dead");
    }

    #[test]
    fn an_empty_custom_command_still_opens_something() {
        let candidates = terminal_candidates("/tmp/repo", "custom", "");

        assert!(!candidates.is_empty());
    }

    #[test]
    fn every_offered_terminal_can_actually_be_started() {
        // The whole reason the list lives in Rust: an option the settings
        // dialog offers and nothing knows how to launch is a button that
        // silently does nothing.
        for option in terminal_options() {
            if option.id == "auto" || option.id == "custom" {
                continue;
            }

            assert!(
                named_terminal(&option.id, "/tmp/repo").is_some(),
                "{} is offered but cannot be launched",
                option.id
            );
        }
    }

    #[test]
    fn the_list_starts_with_automatic_and_ends_with_custom() {
        let options = terminal_options();

        assert_eq!(options.first().unwrap().id, "auto");
        assert_eq!(options.last().unwrap().id, "custom");
        assert!(options.len() > 2, "a platform with no terminals is a bug");
    }

    #[test]
    fn a_terminal_from_another_platform_is_not_invented() {
        // A settings file copied from a Mac to a PC names something this
        // machine has never had.
        assert!(named_terminal("no-such-terminal", "/tmp").is_none());
    }

    #[test]
    fn a_custom_command_splits_into_a_program_and_arguments() {
        let (program, args) = custom_terminal("alacritty --working-directory {path}", "/tmp/x")
            .expect("a command with a program in it");

        assert_eq!(program, "alacritty");
        assert_eq!(args, ["--working-directory", &native_path("/tmp/x")]);
    }

    #[test]
    fn a_path_with_spaces_stays_one_argument() {
        // The substitution happens after splitting, which is the whole reason
        // it is done in that order: "my repos" is one directory, not two.
        let (_, args) =
            custom_terminal("term --cd {path}", "/home/me/my repos/app").expect("a command");

        assert_eq!(args.len(), 2);
        assert_eq!(args[1], native_path("/home/me/my repos/app"));
    }

    #[test]
    fn a_quoted_program_path_survives_its_spaces() {
        let (program, args) =
            custom_terminal("\"C:/Program Files/WezTerm/wezterm.exe\" start", "/tmp")
                .expect("a command");

        assert_eq!(program, "C:/Program Files/WezTerm/wezterm.exe");
        assert_eq!(args, ["start"]);
    }

    #[test]
    fn the_placeholder_works_in_the_middle_of_an_argument() {
        let (_, args) = custom_terminal("term --working-directory={path}", "/tmp/x")
            .expect("a command");

        assert_eq!(args[0], format!("--working-directory={}", native_path("/tmp/x")));
    }

    #[test]
    fn an_empty_custom_command_is_not_a_command() {
        assert!(custom_terminal("", "/tmp").is_none());
        assert!(custom_terminal("   ", "/tmp").is_none());
    }

    #[test]
    fn shell_operators_are_arguments_rather_than_syntax() {
        // Nothing typed in that box may become a second command. There is no
        // shell here, so a semicolon is a semicolon.
        let (program, args) = custom_terminal("term ; rm -rf /", "/tmp").expect("a command");

        assert_eq!(program, "term");
        assert_eq!(args, [";", "rm", "-rf", "/"]);
    }

    #[test]
    fn splitting_collapses_the_gaps() {
        assert_eq!(split_command("  a   b  "), ["a", "b"]);
        assert!(split_command("").is_empty());
    }

    #[test]
    fn every_terminal_candidate_names_a_program() {
        for (program, _) in terminal_commands("/tmp") {
            assert!(!program.is_empty());
        }
    }
}


/* --- code editors ------------------------------------------------------- */

/// An editor the user can pick in settings.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EditorOption {
    pub id: String,
    pub label: String,
    /// Found on this machine. The picker greys the rest out rather than
    /// hiding them, so "why is mine not listed" answers itself.
    pub installed: bool,
}

/// Where each editor's command-line launcher lives.
///
/// Everything a name on PATH would find, then the places an installer puts it
/// without touching PATH -- VS Code's per-user install leaves `code.cmd` under
/// Local/Programs and nowhere else.
fn editor_launchers(id: &str, roots: &[String]) -> Vec<String> {
    let mut out = Vec::new();

    let (names, under): (&[&str], &[&str]) = match id {
        "vscode" => (
            &["code.cmd", "code"],
            &["Microsoft VS Code/bin/code.cmd", "Microsoft VS Code/bin/code"],
        ),
        "cursor" => (
            &["cursor.cmd", "cursor"],
            &["cursor/resources/app/bin/cursor.cmd"],
        ),
        "sublime" => (&["subl.exe", "subl"], &["Sublime Text/subl.exe"]),
        "zed" => (&["zed.exe", "zed"], &["Zed/Zed.exe"]),
        // GUI builds first, so a machine that has one opens a window of its
        // own rather than a terminal. The plain binaries are terminal
        // editors and are hosted in one -- see `hosted`.
        "vim" => (&["gvim.exe", "gvim", "vim.exe", "vim"], &["Vim/vim91/gvim.exe", "Vim/vim90/gvim.exe"]),
        "neovim" => (
            &["nvim-qt.exe", "neovide.exe", "nvim-qt", "neovide", "nvim.exe", "nvim"],
            &["Neovim/bin/nvim-qt.exe", "Neovim/bin/nvim.exe"],
        ),
        _ => return out,
    };

    // Git for Windows ships vim under usr/bin, off PATH. Found the same way
    // Git Bash is: by walking up from the git.exe that is on PATH.
    if id == "vim" && cfg!(windows) {
        if let Some(git) = on_path("git.exe") {
            let mut dir = parent_dir(&git);
            for _ in 0..3 {
                let Some(current) = dir else { break };
                out.push(format!("{current}/usr/bin/vim.exe"));
                dir = parent_dir(current);
            }
        }
    }

    for name in names {
        if let Some(found) = on_path(name) {
            out.push(found);
        }
    }

    for root in roots {
        for rel in under {
            out.push(format!("{root}/{rel}"));
        }
    }

    if cfg!(target_os = "macos") {
        match id {
            "vscode" => out.push(
                "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code".into(),
            ),
            "cursor" => out.push("/Applications/Cursor.app/Contents/Resources/app/bin/cursor".into()),
            "zed" => out.push("/Applications/Zed.app/Contents/MacOS/cli".into()),
            "sublime" => out.push("/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl".into()),
            _ => {}
        }
    }

    out
}

/// Every editor this app knows how to start, in the order "automatic" tries
/// them.
const EDITORS: &[(&str, &str)] = &[
    ("vscode", "Visual Studio Code"),
    ("cursor", "Cursor"),
    ("zed", "Zed"),
    ("sublime", "Sublime Text"),
    ("neovim", "Neovim"),
    ("vim", "Vim"),
];

/// Whether a launcher opens a window of its own. Everything else is a
/// terminal editor and has to be given a terminal to run in.
fn is_gui(program: &str) -> bool {
    let stem = std::path::Path::new(program)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    !matches!(stem.as_str(), "vim" | "nvim")
}

/// The launcher for an editor, if it is installed.
pub fn editor_program(id: &str) -> Option<String> {
    editor_launchers(id, &install_roots())
        .into_iter()
        .find(|candidate| std::path::Path::new(candidate).is_file())
        .map(|found| native_path(&found))
}

/// A terminal command that opens a shell at `path` and runs `program` there.
///
/// Every host sets the directory itself, so the editor is handed `.` rather
/// than the path -- which also keeps a path with spaces out of the one place
/// it would have to be quoted differently per shell. A custom terminal is a
/// template we cannot inject a command into, so it yields nothing and the
/// automatic list is used instead.
pub fn terminal_running(id: &str, path: &str, program: &str) -> Option<(String, Vec<String>)> {
    let native = native_path(path);
    let quoted_ps = program.replace('\'', "''");

    let (host, args): (String, Vec<String>) = match id {
        "wt" => ("wt.exe".into(), vec!["-d".into(), native, program.into(), ".".into()]),
        "powershell" | "pwsh" => (
            format!("{id}.exe"),
            vec![
                "-NoExit".into(),
                "-Command".into(),
                format!(
                    "Set-Location -LiteralPath '{}'; & '{quoted_ps}' .",
                    native.replace('\'', "''")
                ),
            ],
        ),
        "cmd" => (
            "cmd.exe".into(),
            vec!["/K".into(), format!("cd /d \"{native}\" && \"{program}\" .")],
        ),
        // AppleScript is the only way to hand Terminal a command to run.
        "terminal" | "iterm" => (
            "osascript".into(),
            vec![
                "-e".into(),
                format!(
                    "tell application \"Terminal\" to do script \"cd '{}' && '{}' .\"",
                    native.replace('\'', "'\\''"),
                    program.replace('\'', "'\\''")
                ),
            ],
        ),
        "gnome-terminal" => (
            "gnome-terminal".into(),
            vec![format!("--working-directory={native}"), "--".into(), program.into(), ".".into()],
        ),
        "konsole" => (
            "konsole".into(),
            vec!["--workdir".into(), native, "-e".into(), program.into(), ".".into()],
        ),
        "xfce4-terminal" => (
            "xfce4-terminal".into(),
            vec![format!("--working-directory={native}"), "-x".into(), program.into(), ".".into()],
        ),
        "alacritty" => (
            "alacritty".into(),
            vec!["--working-directory".into(), native, "-e".into(), program.into(), ".".into()],
        ),
        "kitty" => ("kitty".into(), vec!["--directory".into(), native, program.into(), ".".into()]),
        "xterm" => ("xterm".into(), vec!["-e".into(), program.into(), ".".into()]),
        _ => return None,
    };

    Some((host, args))
}

/// Put a terminal editor inside the terminal the user chose, or the first one
/// this platform usually has.
fn hosted(path: &str, program: &str, terminal: &str) -> Option<(String, Vec<String>)> {
    if let Some(found) = terminal_running(terminal, path, program) {
        return Some(found);
    }

    let ids: &[&str] = if cfg!(windows) {
        &["wt", "powershell", "cmd"]
    } else if cfg!(target_os = "macos") {
        &["terminal"]
    } else {
        &["gnome-terminal", "konsole", "xfce4-terminal", "alacritty", "kitty", "xterm"]
    };

    ids.iter().find_map(|id| terminal_running(id, path, program))
}

/// What to offer in settings, with what is actually here marked.
pub fn editor_options() -> Vec<EditorOption> {
    let known: Vec<EditorOption> = EDITORS
        .iter()
        .map(|(id, label)| EditorOption {
            id: (*id).into(),
            label: (*label).into(),
            installed: editor_program(id).is_some(),
        })
        .collect();

    let any = known.iter().any(|editor| editor.installed);

    let mut options = vec![EditorOption {
        id: "auto".into(),
        label: "Choose automatically".into(),
        installed: any,
    }];
    options.extend(known);
    options.push(EditorOption {
        id: "custom".into(),
        label: "Custom command".into(),
        installed: true,
    });
    options
}

/// How to open a path in a named editor. None when it is not installed.
///
/// A GUI editor is started on the path. A terminal editor is started inside
/// `terminal`, since it has no window of its own to open.
pub fn named_editor(id: &str, path: &str, terminal: &str) -> Option<(String, Vec<String>)> {
    let program = editor_program(id)?;

    if is_gui(&program) {
        return Some((program, vec![native_path(path)]));
    }

    hosted(path, &program, terminal)
}

/// Everything to try, in order, for a given setting.
///
/// Same rule as the terminal: a choice we can honour is the only thing tried.
/// Opening a different editor than the one chosen is indistinguishable from
/// the setting being ignored.
pub fn editor_candidates(
    path: &str,
    choice: &str,
    custom: &str,
    terminal: &str,
) -> Vec<(String, Vec<String>)> {
    let chosen = match choice {
        "custom" => custom_terminal(custom, path),
        "" | "auto" => None,
        id => named_editor(id, path, terminal),
    };

    if let Some(chosen) = chosen {
        return vec![chosen];
    }

    // Nothing chosen, or a choice this machine cannot honour: the first
    // editor that is actually here.
    EDITORS
        .iter()
        .filter_map(|(id, _)| named_editor(id, path, terminal))
        .take(1)
        .collect()
}

/// Open the repository in a code editor.
pub async fn open_editor(
    path: &str,
    choice: &str,
    custom: &str,
    terminal: &str,
) -> Result<String> {
    let candidates = editor_candidates(path, choice, custom, terminal);

    if candidates.is_empty() {
        return Err(AppError::Git {
            code: -1,
            stderr: if choice == "auto" || choice.is_empty() {
                "No code editor was found. Install one, or set a custom command in Settings.".into()
            } else {
                format!("{choice} is not installed on this machine. Pick another editor in Settings.")
            },
        });
    }

    let (program, args) = &candidates[0];
    spawn(program, args, path).await?;

    Ok(format!("Opened {program} in {path}"))
}

#[cfg(test)]
mod editor_tests {
    use super::*;

    #[test]
    fn the_list_starts_with_automatic_and_ends_with_custom() {
        let options = editor_options();

        assert_eq!(options.first().unwrap().id, "auto");
        assert_eq!(options.last().unwrap().id, "custom");
        assert!(options.last().unwrap().installed, "a custom command is always available");
    }

    #[test]
    fn every_offered_editor_has_somewhere_to_be_looked_for() {
        // Whether it is installed depends on the machine; that it is looked
        // for at all does not. An id in the picker with no launcher path
        // would be greyed out forever, everywhere.
        for (id, _) in EDITORS {
            assert!(
                !editor_launchers(id, &["C:/Program Files".into()]).is_empty(),
                "{id} has nowhere to be found"
            );
        }
    }

    #[test]
    fn automatic_reports_installed_only_when_something_is() {
        let options = editor_options();
        let any = options.iter().skip(1).take(EDITORS.len()).any(|e| e.installed);

        assert_eq!(options[0].installed, any);
    }

    #[test]
    fn a_chosen_editor_is_never_quietly_replaced() {
        for (id, _) in EDITORS {
            let candidates = editor_candidates("/tmp/repo", id, "", "auto");
            assert!(candidates.len() <= 1, "{id}: nothing may queue behind a choice");
        }
    }

    #[test]
    fn a_custom_command_is_the_only_thing_tried() {
        let candidates = editor_candidates("/tmp/repo", "custom", "my-editor --wait {path}", "auto");

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].0, "my-editor");
        assert_eq!(candidates[0].1[0], "--wait");
    }

    #[test]
    fn an_unknown_editor_falls_to_the_automatic_choice() {
        let auto = editor_candidates("/tmp/repo", "auto", "", "auto");
        let unknown = editor_candidates("/tmp/repo", "no-such-editor", "", "auto");

        assert_eq!(unknown, auto);
    }

    #[test]
    fn a_terminal_editor_is_told_apart_from_a_windowed_one() {
        assert!(!is_gui("C:/Program Files/Git/usr/bin/vim.exe"));
        assert!(!is_gui("/usr/bin/nvim"));
        assert!(is_gui("C:/Program Files/Vim/vim91/gvim.exe"));
        assert!(is_gui("/usr/bin/nvim-qt"));
        assert!(is_gui("C:/x/neovide.exe"));
    }

    #[test]
    fn windows_terminal_runs_the_editor_in_the_repository() {
        let (host, args) = terminal_running("wt", "C:/my repos/app", "nvim.exe").unwrap();

        assert_eq!(host, "wt.exe");
        assert_eq!(args[0], "-d");
        assert!(args[1].ends_with("app"));
        assert_eq!(&args[2..], ["nvim.exe", "."]);
    }

    #[test]
    fn powershell_changes_directory_then_calls_the_editor() {
        // The call operator is what lets a program with spaces in its path be
        // invoked from a string; without it PowerShell prints the path.
        let (_, args) = terminal_running("powershell", "C:/repo", "C:/Program Files/Neovim/bin/nvim.exe").unwrap();
        let script = args.last().unwrap();

        assert!(script.starts_with("Set-Location -LiteralPath"));
        assert!(script.contains("& 'C:/Program Files/Neovim/bin/nvim.exe' ."));
    }

    #[test]
    fn cmd_quotes_both_the_directory_and_the_program() {
        let (_, args) = terminal_running("cmd", "C:/my repos/app", "C:/x y/vim.exe").unwrap();

        assert_eq!(args[0], "/K");
        assert!(args[1].contains("cd /d \""));
        assert!(args[1].contains("\"C:/x y/vim.exe\" ."));
    }

    #[test]
    fn linux_terminals_separate_their_own_flags_from_the_command() {
        let (_, gnome) = terminal_running("gnome-terminal", "/r", "nvim").unwrap();
        assert_eq!(&gnome[1..], ["--", "nvim", "."]);

        let (_, konsole) = terminal_running("konsole", "/r", "nvim").unwrap();
        assert_eq!(&konsole[2..], ["-e", "nvim", "."]);
    }

    #[test]
    fn a_custom_terminal_cannot_host_an_editor() {
        // A template is a command line we cannot inject into, so hosting falls
        // to the automatic list rather than guessing where the editor goes.
        assert!(terminal_running("custom", "/r", "nvim").is_none());
    }

    #[cfg(windows)]
    #[test]
    fn git_for_windows_vim_is_found_off_path() {
        // The case most Windows users are in: no editor they chose, but the
        // vim that Git for Windows ships under usr/bin, which is on nobody's
        // PATH. Resolving it is what makes Vim show as installed for them.
        // git.exe may be cmd/, bin/ or mingw64/bin/ -- the root is one, two
        // or three levels up, the same walk the launcher does.
        let Some(git) = on_path("git.exe") else { return };
        let mut dir = parent_dir(&git);
        let mut bundled = false;
        for _ in 0..3 {
            let Some(current) = dir else { break };
            if std::path::Path::new(&format!("{current}/usr/bin/vim.exe")).is_file() {
                bundled = true;
                break;
            }
            dir = parent_dir(current);
        }
        if !bundled {
            return;
        }

        let found = editor_program("vim").expect("vim ships with Git for Windows");
        eprintln!("vim resolved to: {found}");

        assert!(std::path::Path::new(&found).is_file());
        assert!(!is_gui(&found), "the Git-bundled vim is a terminal editor");
    }

    #[test]
    fn every_offered_editor_has_somewhere_to_be_looked_for_including_the_new_ones() {
        for id in ["vim", "neovim"] {
            assert!(!editor_launchers(id, &["C:/Program Files".into()]).is_empty(), "{id}");
        }
    }
}
