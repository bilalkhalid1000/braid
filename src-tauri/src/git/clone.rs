use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tokio::io::{AsyncReadExt, BufReader};
use tokio::process::Command;

use crate::error::{AppError, Result};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The event carrying clone progress to the window.
pub const CLONE_PROGRESS_EVENT: &str = "clone://progress";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    /// The phase git is in: "Receiving objects", "Resolving deltas", and so on.
    pub phase: String,
    /// 0-100 where git reported one, otherwise None — counting phases like
    /// "remote: Enumerating objects" have no total to divide by.
    pub percent: Option<u8>,
}

/// Clone `url` into `path`, reporting progress as it goes.
///
/// Progress is the whole reason this is not just another `run_reported` call.
/// A clone of anything substantial takes minutes, and a window that says only
/// "working" for that long is indistinguishable from one that has hung.
pub async fn clone(
    url: &str,
    path: &Path,
    mut on_progress: impl FnMut(CloneProgress),
) -> Result<PathBuf> {
    if path.exists() {
        // git would say "already exists and is not an empty directory", which
        // is true but buries which path it means.
        let mut entries = tokio::fs::read_dir(path).await?;
        if entries.next_entry().await?.is_some() {
            return Err(AppError::Git {
                code: 1,
                stderr: format!("{} already exists and is not empty.", path.display()),
            });
        }
    }

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let mut command = Command::new("git");
    command
        // Without this git writes no progress at all: it suppresses it when
        // stderr is a pipe rather than a terminal, which is exactly our case.
        .args(["clone", "--progress", url])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Fail rather than block forever waiting for a password nobody can
        // type. A configured credential helper still answers.
        .env("GIT_TERMINAL_PROMPT", "0");

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn()?;
    let stderr = child.stderr.take().expect("stderr was piped");

    let mut reader = BufReader::new(stderr);
    let mut buffer = [0u8; 4096];
    let mut line = String::new();
    let mut tail = String::new();

    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }

        for ch in String::from_utf8_lossy(&buffer[..read]).chars() {
            // git separates progress updates with a carriage return so a
            // terminal overwrites the line in place. Splitting on newlines
            // alone would collect the entire clone into one string and report
            // nothing until it finished.
            if ch == '\r' || ch == '\n' {
                if !line.trim().is_empty() {
                    if let Some(progress) = parse(&line) {
                        on_progress(progress);
                    }
                    tail = line.trim().to_string();
                }
                line.clear();
            } else {
                line.push(ch);
            }
        }
    }

    let status = child.wait().await?;
    if !status.success() {
        return Err(AppError::Git {
            code: status.code().unwrap_or(-1),
            // The last thing git said is the reason it stopped.
            stderr: if tail.is_empty() {
                "git clone failed".into()
            } else {
                tail
            },
        });
    }

    Ok(path.to_path_buf())
}

/// Read one of git's progress lines.
///
/// They look like `Receiving objects:  47% (470/1000), 1.2 MiB | 600 KiB/s`,
/// and sometimes carry no percentage at all.
fn parse(line: &str) -> Option<CloneProgress> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    // "remote: Counting objects: 12" is the server talking; the prefix is
    // noise once it is on its own line.
    let line = line.strip_prefix("remote: ").unwrap_or(line);
    let (phase, rest) = line.split_once(':')?;

    let phase = phase.trim();
    if phase.is_empty() {
        return None;
    }

    let percent = rest
        .split_once('%')
        .and_then(|(before, _)| before.trim().rsplit(' ').next()?.parse::<u16>().ok())
        .map(|n| n.min(100) as u8);

    Some(CloneProgress {
        phase: phase.to_string(),
        percent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_phase_and_its_percentage() {
        let p = parse("Receiving objects:  47% (470/1000), 1.2 MiB | 600 KiB/s").unwrap();

        assert_eq!(p.phase, "Receiving objects");
        assert_eq!(p.percent, Some(47));
    }

    #[test]
    fn reads_a_phase_that_has_no_percentage() {
        // Counting phases have no total to divide by, and reporting 0% for
        // them would look like no progress rather than unknown progress.
        let p = parse("remote: Enumerating objects: 1531").unwrap();

        assert_eq!(p.phase, "Enumerating objects");
        assert_eq!(p.percent, None);
    }

    #[test]
    fn drops_the_remote_prefix() {
        assert_eq!(parse("remote: Compressing objects:  10% (1/10)").unwrap().phase,
                   "Compressing objects");
    }

    #[test]
    fn clamps_a_percentage_that_cannot_be_one() {
        // Defensive: a byte is what goes over the wire, and 255% would wrap.
        assert_eq!(parse("Receiving objects: 4000% (1/1)").unwrap().percent, Some(100));
    }

    #[test]
    fn ignores_lines_that_are_not_progress() {
        assert!(parse("").is_none());
        assert!(parse("   ").is_none());
        assert!(parse("Cloning into 'thing'...").is_none());
    }

    #[test]
    fn keeps_the_hundred_percent_that_ends_a_phase() {
        let p = parse("Resolving deltas: 100% (900/900), done.").unwrap();

        assert_eq!(p.phase, "Resolving deltas");
        assert_eq!(p.percent, Some(100));
    }
}
