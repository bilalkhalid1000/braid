//! Where HEAD has been, and the way back.
//!
//! The reflog is git's own record of every move HEAD made, kept for months.
//! It is what makes most mistakes recoverable, and what undo is built on.

use serde::Serialize;

use super::cli::Git;
use crate::error::{AppError, Result};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub oid: String,
    pub short: String,
    /// `HEAD@{n}`, newest first from zero.
    pub selector: String,
    /// What moved HEAD, in git's words: "commit: Add x", "checkout: moving
    /// from a to b", "rebase (finish): ...".
    pub subject: String,
    /// When, relative: "3 minutes ago".
    pub when: String,
}

const FIELD: &str = "\x1f";

/// The newest `limit` moves of HEAD.
pub async fn reflog(git: &Git, limit: usize) -> Result<Vec<ReflogEntry>> {
    let count = format!("-n{limit}");
    let format = format!("--format=%H{FIELD}%h{FIELD}%gd{FIELD}%gs{FIELD}%cr");
    // Exit 128 in a repository with no commits yet: an empty reflog, not an error.
    let out = git
        .run_str_allowing(&["log", "--walk-reflogs", &count, &format, "HEAD"], &[128])
        .await?;

    Ok(parse(&out))
}

pub fn parse(text: &str) -> Vec<ReflogEntry> {
    text.lines()
        .filter_map(|line| {
            let mut fields = line.split(FIELD);
            Some(ReflogEntry {
                oid: fields.next()?.to_string(),
                short: fields.next()?.to_string(),
                selector: fields.next()?.to_string(),
                subject: fields.next()?.to_string(),
                when: fields.next().unwrap_or_default().to_string(),
            })
        })
        .collect()
}

/// The branch a checkout entry came from, when it is one.
fn checkout_origin(subject: &str) -> Option<&str> {
    let rest = subject.strip_prefix("checkout: moving from ")?;
    let (from, _) = rest.split_once(" to ")?;
    Some(from)
}

/// Put HEAD back where it was before the last thing that moved it.
///
/// A checkout is undone by checking out where it came from. Anything else --
/// a commit, a reset, a rebase, a merge -- is undone by moving the branch
/// back to the previous entry, hard, which is why it refuses while there are
/// uncommitted changes to tracked files: those would go with it.
pub async fn undo(git: &Git) -> Result<String> {
    let entries = reflog(git, 2).await?;
    let (last, before) = match entries.as_slice() {
        [last, before, ..] => (last, before),
        _ => {
            return Err(AppError::Git {
                code: 1,
                stderr: "Nothing to undo: HEAD has not moved yet.".into(),
            })
        }
    };

    if let Some(origin) = checkout_origin(&last.subject) {
        git.run_reported(&["checkout", origin]).await?;
        return Ok(format!("Back on {origin}"));
    }

    let dirty = git.run(&["diff", "--quiet"]).await.is_err()
        || git.run(&["diff", "--cached", "--quiet"]).await.is_err();
    if dirty {
        return Err(AppError::Git {
            code: 1,
            stderr: "Undo moves the branch back hard, and there are uncommitted changes that \
                     would go with it. Commit or stash them first."
                .into(),
        });
    }

    git.run_reported(&["reset", "--hard", &before.oid]).await?;
    Ok(format!(
        "Undid \"{}\": back at {}",
        last.subject, before.short
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_entries() {
        let text = "abc\x1fabc\x1fHEAD@{0}\x1fcommit: Add x\x1f2 minutes ago\n\
                    def\x1fdef\x1fHEAD@{1}\x1fcheckout: moving from main to dev\x1f1 hour ago";
        let entries = parse(text);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].selector, "HEAD@{1}");
        assert_eq!(entries[1].subject, "checkout: moving from main to dev");
        assert_eq!(entries[1].when, "1 hour ago");
    }

    #[test]
    fn reads_where_a_checkout_came_from() {
        assert_eq!(
            checkout_origin("checkout: moving from main to dev"),
            Some("main")
        );
        assert_eq!(checkout_origin("commit: Add x"), None);
    }
}
