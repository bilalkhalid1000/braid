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
        "gitbash" => ("git-bash.exe", vec![format!("--cd={}", native.replace('\\', "/"))]),

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
pub async fn open_terminal(path: &str, choice: &str, custom: &str) -> Result<String> {
    let mut candidates = Vec::new();

    match choice {
        "custom" => candidates.extend(custom_terminal(custom, path)),
        "" | "auto" => {}
        id => candidates.extend(named_terminal(id, path)),
    }

    candidates.extend(terminal_commands(path));

    let mut tried: Vec<String> = Vec::new();

    for (program, args) in &candidates {
        match spawn(program, args, path).await {
            Ok(()) => return Ok(format!("Opened {program} in {path}")),
            Err(_) => tried.push(program.clone()),
        }
    }

    Err(AppError::Git {
        code: -1,
        stderr: format!("No terminal could be launched. Tried: {}.", tried.join(", ")),
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
