//! A real repository on disk, for tests that need git to actually run.
//!
//! Everything else in this crate is tested against strings written by hand,
//! which proves the parsing but not that git produces what the fixtures claim.
//! These tests close that gap: they make a repository, drive it, and read the
//! result back through the same functions the app uses.
//!
//! Every integration binary compiles this module separately, so a helper used
//! by one file looks dead to the others. The allow is about that, not about
//! anything here being unused.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

use braid_lib::git::Git;

/// A counter rather than a timestamp: tests run in parallel and Windows' clock
/// is coarse enough that two of them can read the same value, which would hand
/// them the same directory.
static NEXT: AtomicUsize = AtomicUsize::new(0);

pub struct TestRepo {
    dir: PathBuf,
    git: Git,
}

impl TestRepo {
    /// An initialized repository with one commit on `main`.
    pub fn new() -> Self {
        let repo = Self::empty();
        repo.write("README.md", "hello\n");
        repo.git(&["add", "-A"]);
        repo.git(&["commit", "-m", "Initial commit"]);
        repo
    }

    /// Initialized but with no commits, for the cases that only exist before
    /// the first one.
    pub fn empty() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "braid-it-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));

        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create test repo directory");

        // `Git::plain` rather than `Git::new`: the fsmonitor daemon would hold
        // a handle to this directory and stop the cleanup from deleting it.
        let repo = Self {
            git: Git::plain(&dir),
            dir,
        };

        repo.git(&["init", "--quiet", "--initial-branch=main"]);

        // Identity and signing come from the machine's config otherwise, which
        // would make these tests pass or fail depending on whose laptop they
        // run on.
        repo.git(&["config", "user.name", "Test"]);
        repo.git(&["config", "user.email", "test@example.invalid"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo.git(&["config", "tag.gpgsign", "false"]);
        repo.git(&["config", "core.autocrlf", "false"]);

        repo
    }

    pub fn git_api(&self) -> &Git {
        &self.git
    }

    pub fn path(&self) -> &Path {
        &self.dir
    }

    /// Run git and return stdout, panicking on failure so a broken fixture
    /// fails the test that set it up rather than the assertion further down.
    pub fn git(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.dir)
            .output()
            .expect("run git");

        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr),
        );

        String::from_utf8_lossy(&output.stdout).to_string()
    }

    /// Run git, allowing failure — for the commands a test expects to refuse.
    pub fn git_allow_failure(&self, args: &[&str]) -> bool {
        Command::new("git")
            .args(args)
            .current_dir(&self.dir)
            .output()
            .expect("run git")
            .status
            .success()
    }

    pub fn write(&self, path: &str, contents: &str) {
        let full = self.dir.join(path);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).expect("create parent directory");
        }
        std::fs::write(full, contents).expect("write file");
    }

    pub fn read(&self, path: &str) -> String {
        std::fs::read_to_string(self.dir.join(path)).expect("read file")
    }

    pub fn exists(&self, path: &str) -> bool {
        self.dir.join(path).exists()
    }

    pub fn remove(&self, path: &str) {
        std::fs::remove_file(self.dir.join(path)).expect("remove file");
    }

    pub fn commit_all(&self, message: &str) {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-m", message]);
    }

    /// A file whose numbered lines make it obvious which hunk a change is in.
    pub fn write_numbered(&self, path: &str, lines: usize) {
        let body: String = (1..=lines).map(|n| format!("line {n}\n")).collect();
        self.write(path, &body);
    }

    pub fn head(&self) -> String {
        self.git(&["rev-parse", "HEAD"]).trim().to_string()
    }
}

impl Drop for TestRepo {
    fn drop(&mut self) {
        // Best effort: a failed cleanup should not mask the test's own result.
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
