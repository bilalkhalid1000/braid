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

/// Terminals to try, in order of preference.
///
/// Windows Terminal is what most people have configured but it is not present
/// on every machine, so a plain console is kept as the fallback rather than
/// letting the button fail on a stock install.
pub fn terminal_commands(path: &str) -> Vec<(&'static str, Vec<String>)> {
    let native = native_path(path);

    if cfg!(windows) {
        vec![
            ("wt.exe", vec!["-d".into(), native.clone()]),
            (
                "powershell.exe",
                vec![
                    "-NoExit".into(),
                    "-Command".into(),
                    format!("Set-Location -LiteralPath '{}'", native.replace('\'', "''")),
                ],
            ),
            ("cmd.exe", vec!["/K".into(), format!("cd /d \"{native}\"")]),
        ]
    } else if cfg!(target_os = "macos") {
        vec![("open", vec!["-a".into(), "Terminal".into(), native])]
    } else {
        vec![
            ("x-terminal-emulator", vec![]),
            ("gnome-terminal", vec![]),
            ("xterm", vec![]),
        ]
    }
}

pub async fn open_file_manager(path: &str) -> Result<String> {
    let (program, args) = file_manager_command(path);

    // explorer.exe exits non-zero even when it succeeded, so only the spawn is
    // checked. Waiting on the status here would report a failure every time.
    spawn(program, &args, path).await?;
    Ok(format!("Opened {path}"))
}

pub async fn open_terminal(path: &str) -> Result<String> {
    let candidates = terminal_commands(path);
    let mut tried = Vec::new();

    for (program, args) in &candidates {
        match spawn(program, args, path).await {
            Ok(()) => return Ok(format!("Opened {program} in {path}")),
            Err(_) => tried.push(*program),
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
    fn every_terminal_candidate_names_a_program() {
        for (program, _) in terminal_commands("/tmp") {
            assert!(!program.is_empty());
        }
    }
}
