//! Moving a branch to an earlier commit, and what that costs.
//!
//! Reset is the one everyday git command that can destroy work with no record
//! of it having existed, so the interesting part here is not running it -- that
//! is one argument -- but being able to say beforehand exactly what will be
//! lost and whether anybody else has it.

use serde::{Deserialize, Serialize};

use super::cli::Git;
use crate::error::{AppError, Result};

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResetMode {
    /// Move the branch. The index and the working tree are left alone, so the
    /// commits' changes are still staged.
    Soft,
    /// Move the branch and the index. Changes stay in the working tree, unstaged.
    Mixed,
    /// Move all three. Anything not committed elsewhere is gone.
    Hard,
}

impl ResetMode {
    pub fn flag(self) -> &'static str {
        match self {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        }
    }

    /// Whether it can destroy uncommitted work.
    pub fn discards_changes(self) -> bool {
        self == ResetMode::Hard
    }
}

/// What resetting to a commit would cost.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResetImpact {
    /// Commits between the target and where the branch is now. These are what
    /// the branch stops pointing at.
    pub dropped: usize,
    /// The tracking branch, when the current branch has one.
    pub upstream: Option<String>,
    /// How many of the dropped commits the upstream already has.
    ///
    /// Non-zero is the case worth a warning: the history is published, so
    /// putting the branch back would need a force push, and anyone who has
    /// pulled it has commits their next pull will not remove.
    pub published: usize,
}

fn count(text: &str) -> usize {
    text.trim().parse().unwrap_or(0)
}

/// The tracking branch, or None when the branch has none or HEAD is detached.
async fn upstream(git: &Git) -> Option<String> {
    let name = git
        // Exit 128 is "no upstream configured", which is an ordinary state and
        // not a failure to report.
        .run_str_allowing(
            &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
            &[128],
        )
        .await
        .ok()?;

    let name = name.trim();
    (!name.is_empty() && name != "@{upstream}").then(|| name.to_string())
}

/// Work out what a reset to `oid` would throw away.
pub async fn impact(git: &Git, oid: &str) -> Result<ResetImpact> {
    let dropped = count(
        &git.run_str_allowing(&["rev-list", "--count", &format!("{oid}..HEAD")], &[128])
            .await?,
    );

    let upstream = upstream(git).await;

    // Counted against the upstream rather than against every remote: the
    // question is whether the branch this one pushes to would have to be
    // rewritten, not whether the commit exists anywhere at all.
    let published = match &upstream {
        Some(name) => count(
            &git.run_str_allowing(&["rev-list", "--count", &format!("{oid}..{name}")], &[128])
                .await?,
        ),
        None => 0,
    };

    Ok(ResetImpact { dropped, upstream, published })
}

/// Move the current branch to a commit.
pub async fn reset(git: &Git, oid: &str, mode: ResetMode) -> Result<String> {
    git.run_reported(&["reset", mode.flag(), oid]).await?;

    Ok(format!("Reset to {oid}"))
}

/// Undo a commit by making another that reverses it.
///
/// The safe counterpart to a reset, and the only one that is safe once the
/// commit has been pushed: history is added to rather than rewritten, so
/// nobody else has to do anything about it.
pub async fn revert(git: &Git, oid: &str) -> Result<String> {
    git.run_reported(&["revert", "--no-edit", oid]).await?;

    Ok(format!("Reverted {oid}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_mode_names_the_flag_git_wants() {
        assert_eq!(ResetMode::Soft.flag(), "--soft");
        assert_eq!(ResetMode::Mixed.flag(), "--mixed");
        assert_eq!(ResetMode::Hard.flag(), "--hard");
    }

    #[test]
    fn only_hard_can_destroy_uncommitted_work() {
        // What the confirmation wording turns on. Soft and mixed leave the
        // changes in the tree; hard is the one with nothing to recover from.
        assert!(ResetMode::Hard.discards_changes());
        assert!(!ResetMode::Soft.discards_changes());
        assert!(!ResetMode::Mixed.discards_changes());
    }

    #[test]
    fn a_mode_survives_the_round_trip_from_the_ui() {
        let mode: ResetMode = serde_json::from_str("\"hard\"").unwrap();
        assert_eq!(mode, ResetMode::Hard);
    }

    #[test]
    fn counts_come_back_as_numbers() {
        assert_eq!(count("3\n"), 3);
        assert_eq!(count("  12  "), 12);
        assert_eq!(count("0"), 0);
    }

    #[test]
    fn an_unreadable_count_is_none_rather_than_a_guess() {
        // An empty repository answers nothing. Reporting zero dropped commits
        // is right; refusing to open the dialog over it is not.
        assert_eq!(count(""), 0);
        assert_eq!(count("fatal: bad revision"), 0);
    }
}

/// The parent of a commit, or an error naming why it has none.
///
/// Both refusals are real cases rather than defensive noise: the first commit
/// in a repository has nothing to rebase onto, and a merge has two parents so
/// "without this commit" does not name one history.
async fn sole_parent(git: &Git, oid: &str) -> Result<String> {
    let parents = git
        .run_str(&["rev-list", "--parents", "-n", "1", oid])
        .await?;

    let mut fields = parents.split_whitespace().skip(1);
    let first = fields.next();

    if fields.next().is_some() {
        return Err(AppError::Git {
            code: 1,
            stderr: "A merge cannot be dropped: it has two histories behind it, and removing \
                     it would not say which one to keep."
                .into(),
        });
    }

    first.map(str::to_string).ok_or_else(|| AppError::Git {
        code: 1,
        stderr: "This is the first commit in the repository, so there is nothing to rebase \
                 the rest onto."
            .into(),
    })
}

/// What dropping a commit would rewrite.
///
/// Everything from the dropped commit onwards gets a new hash, so the cost is
/// measured from its parent -- not from the commit itself, as a reset is.
pub async fn drop_impact(git: &Git, oid: &str) -> Result<ResetImpact> {
    let parent = sole_parent(git, oid).await?;

    impact(git, &parent).await
}

/// Remove a commit from the middle of the current branch.
///
/// Every commit after it is replayed, so this is a rewrite: the same cost as a
/// reset, and worth the same warning when the history is published. It can stop
/// on a conflict like any rebase, which leaves the repository mid-operation --
/// the state the operation banner exists to report.
pub async fn drop_commit(git: &Git, oid: &str) -> Result<String> {
    let parent = sole_parent(git, oid).await?;

    // Not reachable from HEAD means it belongs to some other branch, and
    // rebasing onto its parent would drag unrelated history along.
    // Exit 1 means "not an ancestor", so the failure is the answer -- allowing
    // that code would return Ok either way and the check would never refuse.
    let reachable = git
        .run(&["merge-base", "--is-ancestor", oid, "HEAD"])
        .await
        .is_ok();

    if !reachable {
        return Err(AppError::Git {
            code: 1,
            stderr: "That commit is not on the branch you have checked out.".into(),
        });
    }

    git.run_reported(&["rebase", "--onto", &parent, oid]).await?;

    Ok(format!("Dropped {oid}"))
}
