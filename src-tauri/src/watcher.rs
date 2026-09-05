use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

use crate::error::{AppError, Result};
use crate::git::Git;

/// How long to wait for a burst of filesystem events to settle before acting.
///
/// A single `npm install` or branch checkout produces thousands of events. Any
/// design that refreshes per event is the polling problem wearing a costume.
const DEBOUNCE: Duration = Duration::from_millis(60);

/// Directory names whose contents never change git state in a way the user
/// cares about, but which produce enormous event volume.
///
/// A backstop behind the repository's own ignore rules, which are what
/// actually decide: see `ignored_dirs`. This list still matters for a
/// project that forgot to ignore its node_modules.
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
    _watcher: Arc<Mutex<RecommendedWatcher>>,
}

/// The directories git ignores in this repository, as absolute paths.
///
/// Asked of git rather than read from .gitignore, so every rule counts:
/// nested ignore files, `.git/info/exclude`, the global excludes file.
/// Taken once, at open. ponytail: a rule added later is not seen until the
/// repository is reopened; the noisy-name backstop covers the usual case.
pub async fn ignored_dirs(git: &Git) -> Vec<PathBuf> {
    let out = git
        .run_str(&[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "-z",
        ])
        .await
        .unwrap_or_default();

    out.split('\0')
        // With --directory an ignored directory is listed once, with a
        // trailing slash, in place of everything under it. Ignored files
        // come without one and are not worth a rule each.
        .filter(|entry| entry.ends_with('/'))
        .map(|entry| git.workdir().join(entry.trim_end_matches('/')))
        .collect()
}

impl RepoWatcher {
    pub fn start<F>(root: PathBuf, git: Git, ignored: Vec<PathBuf>, on_change: F) -> Result<Self>
    where
        F: Fn() + Send + Sync + 'static,
    {
        let (tx, mut rx) = mpsc::unbounded_channel::<Event>();
        let filter_root = root.clone();
        let ignored = Arc::new(ignored);
        let filter_ignored = Arc::clone(&ignored);

        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };

            if event
                .paths
                .iter()
                .any(|p| is_relevant(p, &filter_root) && !under_any(p, &filter_ignored))
            {
                // Send failure just means the app is shutting down.
                let _ = tx.send(event);
            }
        })
        .map_err(|e| AppError::Watch(e.to_string()))?;
        let watcher = Arc::new(Mutex::new(watcher));

        if cfg!(target_os = "linux") {
            // inotify costs one watch per directory, and a recursive watch
            // takes every directory there is: 8,452 in one ordinary Node
            // project, of which 66 were outside node_modules and the like.
            // Walking the tree here, and stopping at the directories whose
            // events are dropped anyway, is what keeps a repository at a few
            // dozen watches rather than thousands, and inside the kernel's
            // per-user limit with several open.
            let mut w = watcher.lock().unwrap();
            let mut first = true;
            for dir in dirs_to_watch(&root, &ignored) {
                let result = w.watch(&dir, RecursiveMode::NonRecursive);
                if first {
                    result.map_err(|e| AppError::Watch(e.to_string()))?;
                    first = false;
                }
                // A directory that cannot be watched -- gone already, or not
                // readable -- is not worth failing the whole repository over.
            }
        } else {
            // On Windows a recursive watch is a single ReadDirectoryChangesW
            // handle on the root, and on macOS one FSEvents stream, so
            // watching the whole tree costs no per-directory traversal. The
            // expense is event volume, which the filter above and the
            // debounce below absorb.
            watcher
                .lock()
                .unwrap()
                .watch(&root, RecursiveMode::Recursive)
                .map_err(|e| AppError::Watch(e.to_string()))?;
        }

        let adder = Arc::clone(&watcher);
        tauri::async_runtime::spawn(async move {
            // Take one event, then swallow everything that arrives within the
            // debounce window, then fire once for the whole burst.
            while let Some(first) = rx.recv().await {
                let mut burst = vec![first];
                while let Ok(Some(event)) = tokio::time::timeout(DEBOUNCE, rx.recv()).await {
                    burst.push(event);
                }

                // A directory made since the walk has no watch yet, and
                // nothing inside it would be seen. Given one, and its
                // children too, because an unpacked tree arrives all at once.
                // Unless git ignores it: a fresh node_modules is exactly the
                // thing not to start watching.
                if cfg!(target_os = "linux") {
                    let created: Vec<PathBuf> = burst
                        .iter()
                        .filter(|event| matches!(event.kind, EventKind::Create(_)))
                        .flat_map(|event| event.paths.iter().cloned())
                        .filter(|p| p.is_dir())
                        .collect();

                    for path in created {
                        let rel = path.to_string_lossy().into_owned();
                        // Exit 0 means ignored; 1 means not; anything else is
                        // git failing, and then the directory is watched, which
                        // errs towards seeing changes.
                        let is_ignored = git
                            .run_allowing(&["check-ignore", "-q", "--", &rel], &[])
                            .await
                            .is_ok();
                        if is_ignored {
                            continue;
                        }

                        let mut w = adder.lock().unwrap();
                        for dir in dirs_to_watch(&path, &ignored) {
                            let _ = w.watch(&dir, RecursiveMode::NonRecursive);
                        }
                    }
                }

                on_change();
            }
        });

        Ok(Self { _watcher: watcher })
    }
}

/// Whether `path` is `dir` or inside it, for any of `dirs`.
fn under_any(path: &Path, dirs: &[PathBuf]) -> bool {
    dirs.iter().any(|dir| path.starts_with(dir))
}

/// The directories worth a watch of their own under `root`, `root` first.
///
/// Stops at the ignored and the noisy directories, whose events would be
/// dropped, and inside `.git` takes only the directory itself and `refs`:
/// `objects` churns on every fetch and never says anything the UI shows.
pub fn dirs_to_watch(root: &Path, ignored: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        out.push(dir.clone());

        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            // Symlinked directories are left alone: following them can loop,
            // and what they point at is watched where it lives, if at all.
            let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
            if !is_dir {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();

            if name == ".git" {
                out.push(path.clone());
                stack_all(&path.join("refs"), &mut out);
                continue;
            }
            if NOISY_DIRS.contains(&name.as_str()) || under_any(&path, ignored) {
                continue;
            }
            stack.push(path);
        }
    }

    out
}

/// Every directory under `dir`, itself included, with nothing skipped.
fn stack_all(dir: &Path, out: &mut Vec<PathBuf>) {
    if !dir.is_dir() {
        return;
    }
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        out.push(d.clone());
        if let Ok(entries) = std::fs::read_dir(&d) {
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|t| t.is_dir()) {
                    stack.push(entry.path());
                }
            }
        }
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

    #[test]
    fn the_walk_stops_at_noisy_directories_and_inside_git_takes_only_refs() {
        let base = std::env::temp_dir().join(format!("braid-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        for dir in [
            "src/lib",
            "node_modules/react/cjs",
            "packages/app/node_modules/x",
            "packages/app/src",
            "coverage/lcov-report",
            ".git/objects/ab",
            ".git/refs/heads/feature",
        ] {
            std::fs::create_dir_all(base.join(dir)).unwrap();
        }

        // What git would have said it ignores: a name not on the noisy list.
        let dirs = dirs_to_watch(&base, &[base.join("coverage")]);
        let rel: Vec<String> = dirs
            .iter()
            .map(|d| d.strip_prefix(&base).unwrap().to_string_lossy().replace('\\', "/"))
            .collect();

        assert_eq!(rel[0], "");
        for expected in [
            "src",
            "src/lib",
            "packages",
            "packages/app",
            "packages/app/src",
            ".git",
            ".git/refs",
            ".git/refs/heads",
            ".git/refs/heads/feature",
        ] {
            assert!(rel.contains(&expected.to_string()), "missing {expected} in {rel:?}");
        }
        assert!(!rel.iter().any(|r| r.contains("node_modules")), "{rel:?}");
        assert!(!rel.iter().any(|r| r.contains("coverage")), "{rel:?}");
        assert!(!rel.iter().any(|r| r.contains("objects")), "{rel:?}");

        let _ = std::fs::remove_dir_all(&base);
    }
}
