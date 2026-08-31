use std::path::Path;

use serde::Serialize;

use super::cli::Git;
use crate::error::{AppError, Result};

/// An operation git has started and not finished.
///
/// A failed pull does not just print an error: it can leave the repository
/// mid-merge, and until that is resolved almost every other command will refuse
/// to run. Showing this is the difference between "something went wrong" and
/// knowing what the repository is actually in the middle of.
#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepoState {
    #[default]
    Clean,
    Merging,
    Rebasing,
    CherryPicking,
    Reverting,
    Bisecting,
}

/// Marker files git writes into the git directory, most specific first.
///
/// Order matters. A rebase that stops on a conflicted step also writes
/// MERGE_HEAD, and answering "merging" there would offer `merge --abort`, which
/// is not the command that gets the user out.
const MARKERS: &[(&str, RepoState)] = &[
    ("rebase-merge", RepoState::Rebasing),
    ("rebase-apply", RepoState::Rebasing),
    ("CHERRY_PICK_HEAD", RepoState::CherryPicking),
    ("REVERT_HEAD", RepoState::Reverting),
    ("MERGE_HEAD", RepoState::Merging),
    ("BISECT_LOG", RepoState::Bisecting),
];

pub async fn detect(git: &Git) -> Result<RepoState> {
    // Resolved through git rather than assuming `.git` is a directory: in a
    // worktree or a submodule it is a file pointing elsewhere.
    let dir = git.run_str(&["rev-parse", "--absolute-git-dir"]).await?;
    Ok(state_from_dir(Path::new(&dir)).await)
}

async fn state_from_dir(dir: &Path) -> RepoState {
    for (marker, state) in MARKERS {
        if tokio::fs::try_exists(dir.join(marker)).await.unwrap_or(false) {
            return *state;
        }
    }

    RepoState::Clean
}

/// Throw the in-progress operation away and return to where it started.
pub async fn abort(git: &Git) -> Result<String> {
    let state = detect(git).await?;

    let args: &[&str] = match state {
        RepoState::Merging => &["merge", "--abort"],
        RepoState::Rebasing => &["rebase", "--abort"],
        RepoState::CherryPicking => &["cherry-pick", "--abort"],
        RepoState::Reverting => &["revert", "--abort"],
        // Bisect has no --abort; reset is the equivalent.
        RepoState::Bisecting => &["bisect", "reset"],
        RepoState::Clean => return Err(nothing_in_progress()),
    };

    git.run_reported(args).await
}

/// Carry on once the conflicts have been staged.
pub async fn continue_operation(git: &Git) -> Result<String> {
    let state = detect(git).await?;

    let args: &[&str] = match state {
        // `merge --continue` rather than `commit`: it refuses when files are
        // still unmerged instead of recording a half-resolved merge.
        RepoState::Merging => &["merge", "--continue"],
        RepoState::Rebasing => &["rebase", "--continue"],
        RepoState::CherryPicking => &["cherry-pick", "--continue"],
        RepoState::Reverting => &["revert", "--continue"],
        RepoState::Bisecting => return Err(bisect_has_no_continue()),
        RepoState::Clean => return Err(nothing_in_progress()),
    };

    // Git opens an editor for the message on continue unless told not to.
    // Without this the command hangs forever on a GUI with no terminal.
    let mut command = vec!["-c", "core.editor=true"];
    command.extend_from_slice(args);

    git.run_reported(&command).await
}

/// Skip the current commit and move on. Only rebase and cherry-pick have one.
pub async fn skip(git: &Git) -> Result<String> {
    let state = detect(git).await?;

    let args: &[&str] = match state {
        RepoState::Rebasing => &["rebase", "--skip"],
        RepoState::CherryPicking => &["cherry-pick", "--skip"],
        _ => {
            return Err(AppError::Git {
                code: 1,
                stderr: "Only a rebase or a cherry-pick can skip a commit.".into(),
            })
        }
    };

    git.run_reported(args).await
}

fn nothing_in_progress() -> AppError {
    AppError::Git {
        code: 1,
        stderr: "There is no operation in progress to act on.".into(),
    }
}

fn bisect_has_no_continue() -> AppError {
    AppError::Git {
        code: 1,
        stderr: "A bisect advances with `git bisect good` or `git bisect bad`.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a fake git directory containing the given marker files.
    fn git_dir(markers: &[&str]) -> tempdir::TempGitDir {
        tempdir::TempGitDir::new(markers)
    }

    /// A minimal scratch directory, so the detection can be tested without a
    /// real repository or a dependency on a temp-file crate.
    mod tempdir {
        use std::path::{Path, PathBuf};
        use std::sync::atomic::{AtomicUsize, Ordering};

        /// Tests run in parallel and Windows' clock is coarse enough that two
        /// of them can read the same timestamp, which handed them the same
        /// directory and let one test see the other's marker files. A counter
        /// cannot collide.
        static NEXT: AtomicUsize = AtomicUsize::new(0);

        pub struct TempGitDir(PathBuf);

        impl TempGitDir {
            pub fn new(markers: &[&str]) -> Self {
                let base = std::env::temp_dir().join(format!(
                    "braid-test-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed),
                ));

                let _ = std::fs::remove_dir_all(&base);
                std::fs::create_dir_all(&base).unwrap();

                for marker in markers {
                    let path = base.join(marker);
                    // `rebase-merge` is a directory; the rest are files. Either
                    // way only its existence matters.
                    if marker.contains('-') {
                        std::fs::create_dir_all(&path).unwrap();
                    } else {
                        std::fs::write(&path, b"").unwrap();
                    }
                }

                Self(base)
            }

            pub fn path(&self) -> &Path {
                &self.0
            }
        }

        impl Drop for TempGitDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[tokio::test]
    async fn an_untouched_repository_is_clean() {
        let dir = git_dir(&[]);
        assert_eq!(state_from_dir(dir.path()).await, RepoState::Clean);
    }

    #[tokio::test]
    async fn merge_head_means_merging() {
        let dir = git_dir(&["MERGE_HEAD"]);
        assert_eq!(state_from_dir(dir.path()).await, RepoState::Merging);
    }

    #[tokio::test]
    async fn both_rebase_layouts_are_recognised() {
        let interactive = git_dir(&["rebase-merge"]);
        let am = git_dir(&["rebase-apply"]);

        assert_eq!(state_from_dir(interactive.path()).await, RepoState::Rebasing);
        assert_eq!(state_from_dir(am.path()).await, RepoState::Rebasing);
    }

    #[tokio::test]
    async fn a_conflicted_rebase_reports_rebasing_not_merging() {
        // Git writes MERGE_HEAD while a rebase step is conflicted. Answering
        // "merging" would offer `merge --abort`, which does not get the user
        // out of a rebase.
        let dir = git_dir(&["rebase-merge", "MERGE_HEAD"]);
        assert_eq!(state_from_dir(dir.path()).await, RepoState::Rebasing);
    }

    #[tokio::test]
    async fn cherry_pick_and_revert_are_distinguished() {
        let cherry = git_dir(&["CHERRY_PICK_HEAD"]);
        let revert = git_dir(&["REVERT_HEAD"]);

        assert_eq!(state_from_dir(cherry.path()).await, RepoState::CherryPicking);
        assert_eq!(state_from_dir(revert.path()).await, RepoState::Reverting);
    }

    #[tokio::test]
    async fn bisect_is_recognised() {
        let dir = git_dir(&["BISECT_LOG"]);
        assert_eq!(state_from_dir(dir.path()).await, RepoState::Bisecting);
    }
}
