use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{Mutex, MutexGuard};

use super::trace;
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
    /// One write at a time per repository. Shared by every clone, so a
    /// session's commands queue behind each other however they were reached.
    ///
    /// Two writes started together are how a delete and a checkout raced:
    /// git's own index lock only makes the loser fail, and ref-level
    /// operations do not take it at all. Reads stay outside it, which is what
    /// keeps a status refresh from waiting on a push.
    writes: Arc<Mutex<()>>,
}

/// Subcommands that only look. Anything not listed is assumed to write,
/// which errs the safe way: a read taken for a write merely waits its turn.
const READS: &[&str] = &[
    "blame",
    "cat-file",
    "check-ignore",
    "count-objects",
    "describe",
    "diff",
    "diff-tree",
    "for-each-ref",
    "grep",
    "log",
    "ls-files",
    "ls-tree",
    "merge-base",
    "name-rev",
    "rev-list",
    "rev-parse",
    "show",
    "status",
    "symbolic-ref",
    "version",
    "--version",
];

/// Whether an invocation only reads. The first argument that is not an option
/// names the subcommand; a few subcommands read or write depending on what
/// follows, and those are looked at one step further.
fn is_read(args: &[&str]) -> bool {
    // `-c key=value` and `-C dir` carry a value that is not the subcommand.
    let mut words = Vec::new();
    let mut skip = false;
    for arg in args {
        if skip {
            skip = false;
            continue;
        }
        if *arg == "-c" || *arg == "-C" {
            skip = true;
            continue;
        }
        if !arg.starts_with('-') {
            words.push(*arg);
        }
    }

    let mut words = words.into_iter();
    let Some(sub) = words.next() else {
        return true;
    };
    let next = words.next();

    match sub {
        "stash" | "worktree" | "submodule" | "remote" | "config" | "flow" => {
            matches!(next, Some("list") | Some("status") | Some("show") | Some("get") | None)
                || (sub == "remote" && args.contains(&"-v"))
                || (sub == "config" && args.iter().any(|a| a.starts_with("--get")))
        }
        "branch" | "tag" => {
            // Listing has no name to act on; anything else creates or changes.
            next.is_none() || args.iter().any(|a| matches!(*a, "--list" | "-l" | "--show-current"))
        }
        other => READS.contains(&other),
    }
}

impl Git {
    pub fn new(workdir: impl Into<PathBuf>) -> Self {
        Self {
            workdir: workdir.into(),
            perf: true,
            writes: Arc::new(Mutex::new(())),
        }
    }

    /// The write lock, held for the life of a writing command and nothing
    /// for a reading one.
    async fn turn(&self, args: &[&str]) -> Option<MutexGuard<'_, ()>> {
        if is_read(args) {
            None
        } else {
            Some(self.writes.lock().await)
        }
    }

    /// The working tree this runs in.
    pub fn workdir(&self) -> &std::path::Path {
        &self.workdir
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
            writes: Arc::new(Mutex::new(())),
        }
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut cmd = crate::system::system_command("git");
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
        let _turn = self.turn(args).await;
        let run = trace::started(args);
        let output = self.command(args).output().await?;
        let code = output.status.code().unwrap_or(-1);
        run.finished(code);

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
        let _turn = self.turn(args).await;
        let mut command = self.command(args);
        command.stdin(Stdio::piped());

        let run = trace::started(args);
        let mut child = command.spawn()?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::App("git did not accept a patch on stdin".into()))?;

        stdin.write_all(input.as_bytes()).await?;
        stdin.shutdown().await?;
        drop(stdin);

        let output = child.wait_with_output().await?;
        run.finished(output.status.code().unwrap_or(-1));

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
        let _turn = self.turn(args).await;
        let run = trace::started(args);
        let output = self.command(args).output().await?;
        run.finished(output.status.code().unwrap_or(-1));

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
    use super::{is_read, join_output};

    #[test]
    fn tells_reads_from_writes() {
        assert!(is_read(&["status", "--porcelain=v2"]));
        assert!(is_read(&["-c", "x=y", "log", "--all"]));
        assert!(is_read(&["stash", "list"]));
        assert!(is_read(&["remote", "-v"]));
        assert!(is_read(&["branch", "--show-current"]));
        assert!(is_read(&["rev-parse", "HEAD"]));

        assert!(!is_read(&["stash", "push", "-m", "x"]));
        assert!(!is_read(&["branch", "-m", "a", "b"]));
        assert!(!is_read(&["tag", "v1"]));
        assert!(!is_read(&["remote", "add", "o", "url"]));
        assert!(!is_read(&["checkout", "main"]));
        assert!(!is_read(&["push", "--force-with-lease"]));
        assert!(!is_read(&["apply", "--cached"]));
    }

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
