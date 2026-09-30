//! The filesystem watcher, against a real repository.
//!
//! The unit tests prove which paths count. These prove that git actually
//! writes where they assume -- a linked worktree's state lives outside its
//! tree, and a watcher that only watched the tree never heard a commit made
//! in one.

mod common;

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use braid_lib::git::Git;
use braid_lib::watcher::{git_dirs, RepoWatcher};
use common::TestRepo;

/// Longer than the debounce, with room for a slow disk.
const SETTLE: Duration = Duration::from_millis(400);

struct Watched {
    fired: Arc<AtomicUsize>,
    _watcher: RepoWatcher,
}

impl Watched {
    async fn start(path: &Path) -> Self {
        let root = Git::discover(path).await.unwrap();
        let git = Git::plain(&root);
        let dirs = git_dirs(&git).await;
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&fired);
        let watcher = RepoWatcher::start(root, dirs, git, vec![], move || {
            counter.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();

        tokio::time::sleep(SETTLE).await;
        fired.store(0, Ordering::SeqCst);
        Self {
            fired,
            _watcher: watcher,
        }
    }

    /// Whether anything fired since the last call.
    async fn fired(&self) -> bool {
        tokio::time::sleep(SETTLE).await;
        self.fired.swap(0, Ordering::SeqCst) > 0
    }
}

fn git_in(dir: &Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("run git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

#[tokio::test(flavor = "multi_thread")]
async fn ref_and_config_changes_in_an_ordinary_repository_are_seen() {
    let repo = TestRepo::new();
    let watched = Watched::start(repo.path()).await;

    repo.git(&["commit", "--allow-empty", "-m", "Second"]);
    assert!(watched.fired().await, "commit");

    repo.git(&["tag", "v1"]);
    assert!(watched.fired().await, "tag");

    repo.git(&["reset", "--soft", "HEAD~1"]);
    assert!(watched.fired().await, "reset");

    repo.git(&["config", "gitflow.branch.master", "main"]);
    assert!(watched.fired().await, "config");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_linked_worktree_sees_its_own_commits_and_the_shared_branches() {
    let repo = TestRepo::new();
    let tree = repo.path().with_extension("wt");
    let _ = std::fs::remove_dir_all(&tree);
    repo.git(&["worktree", "add", "-q", "-b", "side", tree.to_str().unwrap()]);

    let watched = Watched::start(&tree).await;

    git_in(&tree, &["commit", "--allow-empty", "-m", "In the worktree"]);
    assert!(watched.fired().await, "commit in the worktree");

    git_in(&tree, &["checkout", "-q", "--detach"]);
    assert!(watched.fired().await, "detach in the worktree");

    // A branch moved from the main checkout is one this worktree can show.
    repo.git(&["commit", "--allow-empty", "-m", "In main"]);
    assert!(watched.fired().await, "commit in the main checkout");

    drop(watched);
    repo.git(&["worktree", "remove", "--force", tree.to_str().unwrap()]);
}

/// On Linux each directory needs a watch of its own, and one made after the
/// walk only gets it if its creation is let through.
#[tokio::test(flavor = "multi_thread")]
async fn a_worktree_added_after_opening_is_seen_to_move() {
    let repo = TestRepo::new();
    let watched = Watched::start(repo.path()).await;

    let tree = repo.path().with_extension("wt3");
    let _ = std::fs::remove_dir_all(&tree);
    repo.git(&["worktree", "add", "-q", "-b", "late", tree.to_str().unwrap()]);
    assert!(watched.fired().await, "worktree added");

    git_in(&tree, &["checkout", "-q", "--detach"]);
    assert!(watched.fired().await, "detach in the new worktree");

    drop(watched);
    repo.git(&["worktree", "remove", "--force", tree.to_str().unwrap()]);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_main_checkout_sees_a_worktree_move_its_head() {
    let repo = TestRepo::new();
    let tree = repo.path().with_extension("wt2");
    let _ = std::fs::remove_dir_all(&tree);
    repo.git(&["worktree", "add", "-q", "-b", "other", tree.to_str().unwrap()]);

    let watched = Watched::start(repo.path()).await;

    git_in(&tree, &["checkout", "-q", "--detach"]);
    assert!(watched.fired().await, "detach in the worktree");

    drop(watched);
    repo.git(&["worktree", "remove", "--force", tree.to_str().unwrap()]);
}
