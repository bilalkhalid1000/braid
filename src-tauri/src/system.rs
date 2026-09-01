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
