use std::path::{Path, PathBuf};
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

use crate::error::{AppError, Result};

/// How long to wait for a burst of filesystem events to settle before acting.
///
/// A single `npm install` or branch checkout produces thousands of events. Any
/// design that refreshes per event is the polling problem wearing a costume.
const DEBOUNCE: Duration = Duration::from_millis(60);

/// Directory names whose contents never change git state in a way the user
/// cares about, but which produce enormous event volume.
///
/// This is a heuristic stand-in. The real fix is reading the repo's `.gitignore`
/// and deriving the skip set from it; that is Phase 5 work.
const NOISY_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "vendor",
    ".venv",
    "__pycache__",
    ".dart_tool",
    ".gradle",
    "Pods",
];

/// Entries inside `.git` that actually represent a state change worth showing.
/// Everything else under `.git` (notably `objects/`, which churns violently
/// during fetch) is ignored.
const GIT_DIR_WATCHED: &[&str] = &[
    "HEAD",
    "index",
    "refs",
    "packed-refs",
    "MERGE_HEAD",
    "ORIG_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "rebase-merge",
    "rebase-apply",
];

/// Watches one worktree and invokes a callback when its git state may have
/// changed. Dropping this stops the watch.
pub struct RepoWatcher {
    _watcher: RecommendedWatcher,
}

impl RepoWatcher {
    pub fn start<F>(root: PathBuf, on_change: F) -> Result<Self>
    where
        F: Fn() + Send + Sync + 'static,
    {
        let (tx, mut rx) = mpsc::unbounded_channel::<()>();
        let filter_root = root.clone();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };

            if event.paths.iter().any(|p| is_relevant(p, &filter_root)) {
                // Send failure just means the app is shutting down.
                let _ = tx.send(());
            }
        })
        .map_err(|e| AppError::Watch(e.to_string()))?;

        // On Windows a recursive watch is a single ReadDirectoryChangesW handle
        // on the root, so watching the whole tree costs no per-directory
        // traversal. The expense is event volume, which the filter above and
        // the debounce below absorb.
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| AppError::Watch(e.to_string()))?;

        tauri::async_runtime::spawn(async move {
            // Take one event, then swallow everything that arrives within the
            // debounce window, then fire once for the whole burst.
            while rx.recv().await.is_some() {
                while tokio::time::timeout(DEBOUNCE, rx.recv()).await.is_ok() {}
                on_change();
            }
        });

        Ok(Self { _watcher: watcher })
    }
}

/// Decide whether a changed path could have altered anything we display.
fn is_relevant(path: &Path, root: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);

    // Lock files are transient and half of them are ours.
    if path.extension().is_some_and(|e| e == "lock") {
        return false;
    }

    let mut components = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned());

    match components.next() {
        None => false,

        Some(first) if first == ".git" => components
            .next()
            .is_some_and(|second| GIT_DIR_WATCHED.contains(&second.as_str())),

        Some(first) => {
            let noisy = |name: &str| NOISY_DIRS.contains(&name);
            !noisy(&first) && !components.any(|c| noisy(&c))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        PathBuf::from("/repo")
    }

    #[test]
    fn ordinary_source_file_is_relevant() {
        assert!(is_relevant(Path::new("/repo/src/main.rs"), &root()));
    }

    #[test]
    fn node_modules_is_ignored_at_any_depth() {
        assert!(!is_relevant(Path::new("/repo/node_modules/react/index.js"), &root()));
        assert!(!is_relevant(
            Path::new("/repo/packages/app/node_modules/x/y.js"),
            &root()
        ));
    }

    #[test]
    fn git_objects_churn_is_ignored_but_refs_are_not() {
        assert!(!is_relevant(Path::new("/repo/.git/objects/ab/cdef"), &root()));
        assert!(is_relevant(Path::new("/repo/.git/refs/heads/main"), &root()));
        assert!(is_relevant(Path::new("/repo/.git/HEAD"), &root()));
        assert!(is_relevant(Path::new("/repo/.git/index"), &root()));
    }

    #[test]
    fn lock_files_are_ignored() {
        assert!(!is_relevant(Path::new("/repo/.git/index.lock"), &root()));
    }
}
