use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::{AppError, Result};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Performance config passed with `-c` on every invocation rather than written
/// into the user's repo config.
///
/// `core.fsmonitor` lets git ask a background daemon which files changed rather
/// than walking the worktree; `core.untrackedCache` avoids re-stat-ing
/// unchanged directories.
///
/// Both are cheap insurance rather than a proven win: at 20k ignored files the
/// benchmark cannot measure a difference (see PLAN.md section 6). The cost that
/// actually dominates on Windows is starting git.exe at all, about 27ms a call.
///
/// Passing these per-invocation means we never mutate state the user did not
/// ask us to mutate, and uninstalling the app leaves no trace.
const PERF_CONFIG: &[&str] = &["core.fsmonitor=true", "core.untrackedCache=true"];

/// A git CLI runner bound to one worktree.
///
/// Writes go through the user's own `git` binary on purpose: hooks, credential
/// helpers, GPG signing, LFS and `.gitconfig` then behave exactly as they do in
/// their terminal. Reads will move to gitoxide behind this same surface once the
/// benchmark harness can prove the difference.
#[derive(Debug, Clone)]
pub struct Git {
    workdir: PathBuf,
    perf: bool,
}

impl Git {
    pub fn new(workdir: impl Into<PathBuf>) -> Self {
        Self {
            workdir: workdir.into(),
            perf: true,
        }
    }

    /// Without the performance config.
    ///
    /// `core.fsmonitor` starts a daemon that watches the worktree, and on
    /// Windows that daemon holds a handle to the directory — which stops a test
    /// from deleting the repository it just made. Anything short-lived wants
    /// this one.
    pub fn plain(workdir: impl Into<PathBuf>) -> Self {
        Self {
            workdir: workdir.into(),
            perf: false,
        }
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new("git");
        cmd.current_dir(&self.workdir);

        // Never take the index lock for a read. Without this, our background
        // status refresh can block the user's own git commands in a terminal.
        cmd.arg("--no-optional-locks");

        if self.perf {
            for kv in PERF_CONFIG {
                cmd.arg("-c").arg(kv);
            }
        }

        cmd.args(args);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Keep git from trying to talk to a terminal we do not have.
        cmd.env("GIT_TERMINAL_PROMPT", "0");
        cmd.env("GIT_OPTIONAL_LOCKS", "0");

        // Without this every git call flashes a console window on Windows.
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd
    }

    /// Run git and return raw stdout. Raw bytes, not a String, because
    /// porcelain output is NUL-separated and paths are not guaranteed UTF-8.
    pub async fn run(&self, args: &[&str]) -> Result<Vec<u8>> {
        self.run_allowing(args, &[]).await
    }

    /// Run git, treating the listed exit codes as success alongside 0.
    ///
    /// Several git commands use a non-zero exit to report a *result* rather
    /// than a failure: `diff --no-index` exits 1 when files differ, and `log`
    /// exits 128 in a repository that has no commits yet.
    pub async fn run_allowing(&self, args: &[&str], allowed: &[i32]) -> Result<Vec<u8>> {
        let output = self.command(args).output().await?;
        let code = output.status.code().unwrap_or(-1);

        if !output.status.success() && !allowed.contains(&code) {
            return Err(AppError::Git {
                code,
                stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            });
        }

        Ok(output.stdout)
    }

    /// Run git with a patch on stdin, as `git apply` expects.
    ///
    /// The pipe is closed before waiting: git reads the patch until EOF, so
    /// holding the handle open would leave both sides waiting on each other.
    pub async fn run_with_stdin(&self, args: &[&str], input: &str) -> Result<String> {
        let mut command = self.command(args);
        command.stdin(Stdio::piped());

        let mut child = command.spawn()?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::App("git did not accept a patch on stdin".into()))?;

        stdin.write_all(input.as_bytes()).await?;
        stdin.shutdown().await?;
        drop(stdin);

        let output = child.wait_with_output().await?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        if !output.status.success() {
            return Err(AppError::Git {
                code: output.status.code().unwrap_or(-1),
                stderr: join_output(stdout.trim(), stderr.trim()),
            });
        }

        Ok(join_output(stdout.trim(), stderr.trim()))
    }

    pub async fn run_str(&self, args: &[&str]) -> Result<String> {
        let out = self.run(args).await?;
        Ok(String::from_utf8_lossy(&out).trim_end().to_string())
    }

    pub async fn run_str_allowing(&self, args: &[&str], allowed: &[i32]) -> Result<String> {
        let out = self.run_allowing(args, allowed).await?;
        Ok(String::from_utf8_lossy(&out).trim_end().to_string())
    }

    /// Run git and return everything it printed, both streams merged.
    ///
    /// Git narrates on stderr even when it succeeds: `fetch` writes its whole
    /// summary there, `checkout` announces the branch there, `push` reports the
    /// ref update there. Reporting only stdout would show the user an empty
    /// result for exactly the commands they most want confirmation from.
    ///
    /// Only for commands whose output is shown to a human — never for anything
    /// that gets parsed, where an interleaved stderr line would corrupt the
    /// result.
    pub async fn run_reported(&self, args: &[&str]) -> Result<String> {
        let output = self.command(args).output().await?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let merged = join_output(stdout.trim(), stderr.trim());

        if !output.status.success() {
            return Err(AppError::Git {
                code: output.status.code().unwrap_or(-1),
                stderr: merged,
            });
        }

        Ok(merged)
    }

    /// Resolve any path inside a repo to that repo's worktree root.
    ///
    /// Returns `NotARepo` for a path that is not in one.
    pub async fn discover(path: &Path) -> Result<PathBuf> {
        let probe = Git::plain(path);

        let root = probe
            .run_str(&["rev-parse", "--show-toplevel"])
            .await
            .map_err(|_| AppError::NotARepo(path.display().to_string()))?;

        if root.is_empty() {
            return Err(AppError::NotARepo(path.display().to_string()));
        }

        Ok(PathBuf::from(root))
    }
}

/// Join two output streams, skipping whichever is empty so the result never
/// starts or ends with a stray blank line.
fn join_output(stdout: &str, stderr: &str) -> String {
    [stdout, stderr]
        .iter()
        .filter(|part| !part.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::join_output;

    #[test]
    fn merges_both_streams() {
        assert_eq!(join_output("out", "err"), "out\nerr");
    }

    #[test]
    fn an_empty_stream_adds_no_blank_line() {
        assert_eq!(join_output("", "err"), "err");
        assert_eq!(join_output("out", ""), "out");
        assert_eq!(join_output("", ""), "");
    }
}
