//! Moving a branch to an earlier commit, and what that costs.
//!
//! Reset is the one everyday git command that can destroy work with no record
//! of it having existed, so the interesting part here is not running it -- that
//! is one argument -- but being able to say beforehand exactly what will be
//! lost and whether anybody else has it.

use serde::{Deserialize, Serialize};

use super::cli::Git;
use crate::error::Result;

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
