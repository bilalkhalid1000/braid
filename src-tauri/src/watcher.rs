use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
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

/// Entries in a checkout's own git directory that represent a state change
/// worth showing. Everything else there (notably `objects/`, which churns
/// violently during fetch) is ignored.
const OWN_STATE: &[&str] = &[
    "HEAD",
    "index",
    // Per-worktree refs: refs/bisect, refs/worktree.
    "refs",
    "MERGE_HEAD",
    "ORIG_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "rebase-merge",
    "rebase-apply",
];

/// Entries in the common git directory that every checkout of the repository
/// shares. A linked worktree reads its branches from here, and its config:
/// remotes, upstreams and the git flow settings all live in `config`.
///
/// Another checkout's index is deliberately not on it. Each tab's status read
/// can rewrite its own index, and two tabs that each reacted to the other's
/// would refresh one another for ever.
const SHARED_STATE: &[&str] = &["refs", "packed-refs", "config"];

/// Where a checkout's git state lives.
///
/// For an ordinary repository both are `<root>/.git`. A linked worktree or a
/// submodule has a `.git` file instead, pointing somewhere outside the tree --
/// `<main>/.git/worktrees/<name>` and `<parent>/.git/modules/<name>` -- and a
/// watch on the tree alone never saw a commit made in one.
#[derive(Debug, Clone)]
pub struct GitDirs {
    /// HEAD, the index, and whatever operation is in progress.
    pub own: PathBuf,
    /// Branches, tags and config.
    pub common: PathBuf,
}

impl GitDirs {
    /// The layout of an ordinary repository, for when git cannot be asked.
    pub fn plain(root: &Path) -> Self {
        let dir = root.join(".git");
        Self {
            own: dir.clone(),
            common: dir,
        }
    }
}

/// Ask git where this checkout's git directories are.
pub async fn git_dirs(git: &Git) -> GitDirs {
    let root = git.workdir();
    let Ok(out) = git
        .run_str(&["rev-parse", "--absolute-git-dir", "--git-common-dir"])
        .await
    else {
        return GitDirs::plain(root);
    };

    let mut lines = out.lines().map(str::trim);
    let (Some(own), Some(common)) = (lines.next(), lines.next()) else {
        return GitDirs::plain(root);
    };

    // The common directory comes back relative to the working directory when
    // it is the ordinary `.git`.
    let own = PathBuf::from(own);
    let common = PathBuf::from(common);
    let common = if common.is_absolute() {
        common
    } else {
        root.join(common)
    };

    GitDirs { own, common }
}

/// Watches one worktree and invokes a callback when its git state may have
/// changed. Dropping this stops the watch.
pub struct RepoWatcher {
    _watcher: Arc<Mutex<RecommendedWatcher>>,
    /// The ignored directories the filter drops events under. Shared with
    /// the filter so it can be filled in after the watch has started: on a
    /// tree with a large node_modules, asking git for the list takes seconds
    /// that the window used to spend waiting on a splash.
    ignored: Arc<RwLock<Vec<PathBuf>>>,
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
    pub fn start<F>(
        root: PathBuf,
        git_dirs: GitDirs,
        git: Git,
        ignored: Vec<PathBuf>,
        on_change: F,
    ) -> Result<Self>
    where
        F: Fn() + Send + Sync + 'static,
    {
        let (tx, mut rx) = mpsc::unbounded_channel::<Event>();
        let filter_root = root.clone();
        let filter_dirs = git_dirs.clone();
        let ignored = Arc::new(RwLock::new(ignored));
        let filter_ignored = Arc::clone(&ignored);
        let ignored_for_self = Arc::clone(&ignored);

        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };

            let dropped = filter_ignored.read().unwrap();
            if event.paths.iter().any(|p| {
                is_relevant(p, &filter_root, &filter_dirs) && !under_any(p, &dropped)
            }) {
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
            let skip = ignored.read().unwrap();
            let mut dirs = dirs_to_watch(&root, &skip);
            for outside in outside(&root, &git_dirs) {
                git_dir_watches(&outside, &mut dirs);
            }
            for dir in dirs {
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
            let mut w = watcher.lock().unwrap();
            w.watch(&root, RecursiveMode::Recursive)
                .map_err(|e| AppError::Watch(e.to_string()))?;

            // A linked worktree's own directory sits inside the common one,
            // so one recursive watch there covers both.
            let mut outside = outside(&root, &git_dirs);
            outside.sort_by_key(|dir| dir.components().count());
            let mut watched: Vec<PathBuf> = Vec::new();
            for dir in outside {
                if under_any(&dir, &watched) {
                    continue;
                }
                // Not fatal: the tree is still watched, and a pointer to a git
                // directory that has gone is git's problem to report.
                if w.watch(&dir, RecursiveMode::Recursive).is_ok() {
                    watched.push(dir);
                }
            }
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
                        let skip = ignored.read().unwrap();
                        for dir in dirs_to_watch(&path, &skip) {
                            let _ = w.watch(&dir, RecursiveMode::NonRecursive);
                        }
                    }
                }

                on_change();
            }
        });

        Ok(Self {
            _watcher: watcher,
            ignored: ignored_for_self,
        })
    }

    /// Replace the ignored directories the filter drops. Events already in
    /// flight are judged by the old list; everything after by the new one.
    pub fn set_ignored(&self, dirs: Vec<PathBuf>) {
        *self.ignored.write().unwrap() = dirs;
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
                git_dir_watches(&path, &mut out);
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

/// The git directories that live outside the tree, and so are not covered by
/// watching it.
fn outside(root: &Path, dirs: &GitDirs) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for dir in [&dirs.common, &dirs.own] {
        if !dir.starts_with(root) && !out.contains(dir) {
            out.push(dir.clone());
        }
    }
    out
}

/// The directories inside a git directory worth a watch of their own: itself,
/// everything under `refs`, and each linked worktree's directory, whose HEAD
/// is what the worktree list shows. Never `objects`.
fn git_dir_watches(dir: &Path, out: &mut Vec<PathBuf>) {
    out.push(dir.to_path_buf());
    stack_all(&dir.join("refs"), out);

    let worktrees = dir.join("worktrees");
    if let Ok(entries) = std::fs::read_dir(&worktrees) {
        out.push(worktrees);
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|t| t.is_dir()) {
                out.push(entry.path());
            }
        }
    }
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
fn is_relevant(path: &Path, root: &Path, dirs: &GitDirs) -> bool {
    // Lock files are transient and half of them are ours.
    if path.extension().is_some_and(|e| e == "lock") {
        return false;
    }

    let names = |rel: &Path| -> Vec<String> {
        rel.components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect()
    };

    // The checkout's own directory first: for a linked worktree it sits
    // inside the common one, and there it is judged as its own.
    if let Ok(rel) = path.strip_prefix(&dirs.own) {
        let rel = names(rel);
        return own_state(&rel) || (dirs.own == dirs.common && shared_state(&rel));
    }
    if let Ok(rel) = path.strip_prefix(&dirs.common) {
        return shared_state(&names(rel));
    }

    let Ok(rel) = path.strip_prefix(root) else {
        return false;
    };
    let rel = names(rel);

    match rel.first() {
        None => false,
        // A `.git` directory not at `dirs.own` is not this checkout's -- and
        // a `.git` file, in a linked worktree, only says where the real one is.
        Some(first) if first == ".git" => false,
        Some(_) => !rel.iter().any(|name| NOISY_DIRS.contains(&name.as_str())),
    }
}

fn own_state(rel: &[String]) -> bool {
    rel.first().is_some_and(|first| OWN_STATE.contains(&first.as_str()))
}

/// Shared state, and each linked worktree's HEAD: the worktree list shows
/// what every checkout has out.
///
/// A worktree's directory appearing or going counts too. The list changes
/// with it, and on Linux the event is what gets the new directory a watch --
/// dropped here, a worktree added after opening was never seen to move.
fn shared_state(rel: &[String]) -> bool {
    match rel {
        [first, ..] if SHARED_STATE.contains(&first.as_str()) => true,
        [worktrees] | [worktrees, _] => worktrees == "worktrees",
        [worktrees, _, head] => worktrees == "worktrees" && head == "HEAD",
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        PathBuf::from("/repo")
    }

    fn plain() -> GitDirs {
        GitDirs::plain(&root())
    }

    /// `/repo` as a linked worktree of `/main`.
    fn linked() -> GitDirs {
        GitDirs {
            own: PathBuf::from("/main/.git/worktrees/repo"),
            common: PathBuf::from("/main/.git"),
        }
    }

    #[test]
    fn config_is_relevant() {
        assert!(is_relevant(Path::new("/repo/.git/config"), &root(), &plain()));
    }

    #[test]
    fn a_linked_worktree_sees_its_own_state_and_the_shared_refs() {
        let at = |p: &str| is_relevant(Path::new(p), &root(), &linked());

        assert!(at("/main/.git/worktrees/repo/HEAD"));
        assert!(at("/main/.git/worktrees/repo/index"));
        assert!(at("/main/.git/worktrees/repo/rebase-merge/done"));
        assert!(at("/main/.git/refs/heads/side"));
        assert!(at("/main/.git/packed-refs"));
        assert!(at("/main/.git/config"));
        assert!(at("/repo/src/main.rs"));

        // The main checkout's index and HEAD are not this one's.
        assert!(!at("/main/.git/index"));
        assert!(!at("/main/.git/HEAD"));
        assert!(!at("/main/.git/objects/ab/cdef"));
        assert!(!at("/main/src/main.rs"));
        // The pointer file says nothing about state.
        assert!(!at("/repo/.git"));
    }

    #[test]
    fn another_checkouts_head_moves_the_worktree_list_but_its_index_does_not() {
        let at = |p: &str| is_relevant(Path::new(p), &root(), &plain());

        assert!(at("/repo/.git/worktrees/other/HEAD"));
        assert!(!at("/repo/.git/worktrees/other/index"));
        // Added or removed: the directory itself.
        assert!(at("/repo/.git/worktrees/other"));
        assert!(at("/repo/.git/worktrees"));

        let from_linked = |p: &str| is_relevant(Path::new(p), &root(), &linked());
        assert!(from_linked("/main/.git/worktrees/other/HEAD"));
        assert!(!from_linked("/main/.git/worktrees/other/index"));
    }

    #[test]
    fn ordinary_source_file_is_relevant() {
        assert!(is_relevant(Path::new("/repo/src/main.rs"), &root(), &plain()));
    }

    #[test]
    fn node_modules_is_ignored_at_any_depth() {
        assert!(!is_relevant(Path::new("/repo/node_modules/react/index.js"), &root(), &plain()));
        assert!(!is_relevant(
            Path::new("/repo/packages/app/node_modules/x/y.js"),
            &root(),
            &plain()
        ));
    }

    #[test]
    fn git_objects_churn_is_ignored_but_refs_are_not() {
        assert!(!is_relevant(Path::new("/repo/.git/objects/ab/cdef"), &root(), &plain()));
        assert!(is_relevant(Path::new("/repo/.git/refs/heads/main"), &root(), &plain()));
        assert!(is_relevant(Path::new("/repo/.git/HEAD"), &root(), &plain()));
        assert!(is_relevant(Path::new("/repo/.git/index"), &root(), &plain()));
    }

    #[test]
    fn lock_files_are_ignored() {
        assert!(!is_relevant(Path::new("/repo/.git/index.lock"), &root(), &plain()));
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
