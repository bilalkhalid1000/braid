use serde::Serialize;

use super::cli::Git;
use crate::error::{AppError, Result};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchRef {
    pub name: String,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub oid: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteGroup {
    pub name: String,
    pub branches: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub selector: String,
    pub message: String,
}

/// Everything the sidebar renders, in one round trip.
///
/// One call rather than four keeps the sidebar consistent: partial refreshes
/// are how a UI ends up showing a branch that was deleted two panels ago.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RefsSnapshot {
    pub branches: Vec<BranchRef>,
    pub remotes: Vec<RemoteGroup>,
    pub tags: Vec<String>,
    pub stashes: Vec<StashEntry>,
}

/// Tab is safe as a field separator: git refnames cannot contain one.
const BRANCH_FORMAT: &str =
    "--format=%(refname:short)\t%(HEAD)\t%(upstream:short)\t%(upstream:track)\t%(objectname:short)";

pub async fn refs(git: &Git) -> Result<RefsSnapshot> {
    let (branches, remotes, tags, stashes) = tokio::try_join!(
        git.run_str(&[
            "for-each-ref",
            "--sort=-committerdate",
            BRANCH_FORMAT,
            "refs/heads",
        ]),
        git.run_str(&[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/remotes",
        ]),
        git.run_str(&[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname:short)",
            "refs/tags",
        ]),
        git.run_str(&["stash", "list", "--format=%gd\t%s"]),
    )?;

    Ok(RefsSnapshot {
        branches: parse_branches(&branches),
        remotes: group_remotes(&remotes),
        tags: tags.lines().map(str::to_string).collect(),
        stashes: parse_stashes(&stashes),
    })
}

fn parse_branches(text: &str) -> Vec<BranchRef> {
    text.lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let name = fields.next()?.to_string();
            let head = fields.next().unwrap_or_default();
            let upstream = fields.next().unwrap_or_default();
            let track = fields.next().unwrap_or_default();
            let oid = fields.next().unwrap_or_default().to_string();

            let (ahead, behind) = parse_track(track);

            Some(BranchRef {
                name,
                is_head: head == "*",
                upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
                ahead,
                behind,
                oid,
            })
        })
        .collect()
}

/// `%(upstream:track)` renders as `[ahead 3, behind 1]`, `[ahead 3]`,
/// `[behind 1]`, `[gone]`, or empty when in sync.
fn parse_track(track: &str) -> (i64, i64) {
    let mut ahead = 0;
    let mut behind = 0;

    let inner = track.trim_start_matches('[').trim_end_matches(']');
    for part in inner.split(", ") {
        let mut words = part.split(' ');
        match (words.next(), words.next().and_then(|n| n.parse().ok())) {
            (Some("ahead"), Some(n)) => ahead = n,
            (Some("behind"), Some(n)) => behind = n,
            _ => {}
        }
    }

    (ahead, behind)
}

/// The remote to publish to when the user has not said.
///
/// `origin` where it exists, because that is what it means. Otherwise the only
/// remote there is -- a repository with one remote called something else should
/// not be told it has none. With several and no `origin`, there is a real
/// choice to make and guessing is worse than asking.
pub async fn default_remote(git: &Git) -> Result<String> {
    let out = git.run_str(&["remote"]).await?;
    let remotes: Vec<&str> = out.lines().map(str::trim).filter(|r| !r.is_empty()).collect();

    if remotes.contains(&"origin") {
        return Ok("origin".into());
    }

    match remotes.as_slice() {
        [only] => Ok((*only).to_string()),
        [] => Err(AppError::Git {
            code: 1,
            stderr: "This repository has no remote to publish to.".into(),
        }),
        many => Err(AppError::Git {
            code: 1,
            stderr: format!(
                "Several remotes and no origin ({}). Pick one to publish to.",
                many.join(", "),
            ),
        }),
    }
}

/// Turn a flat `origin/main`, `origin/dev`, `upstream/main` list into groups.
fn group_remotes(text: &str) -> Vec<RemoteGroup> {
    let mut groups: Vec<RemoteGroup> = Vec::new();

    for full in text.lines() {
        // `origin/HEAD` is a symbolic pointer, not a branch anyone checks out.
        if full.ends_with("/HEAD") {
            continue;
        }

        let Some((remote, branch)) = full.split_once('/') else {
            continue;
        };

        match groups.iter_mut().find(|g| g.name == remote) {
            Some(group) => group.branches.push(branch.to_string()),
            None => groups.push(RemoteGroup {
                name: remote.to_string(),
                branches: vec![branch.to_string()],
            }),
        }
    }

    groups
}

fn parse_stashes(text: &str) -> Vec<StashEntry> {
    text.lines()
        .filter_map(|line| {
            let (selector, message) = line.split_once('\t')?;
            Some(StashEntry {
                selector: selector.to_string(),
                message: message.to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_the_checked_out_branch() {
        let text = "main\t*\torigin/main\t\tabc1234\nfeature\t \t\t\tdef5678";
        let branches = parse_branches(text);

        assert!(branches[0].is_head);
        assert!(!branches[1].is_head);
        assert_eq!(branches[0].upstream.as_deref(), Some("origin/main"));
        assert_eq!(branches[1].upstream, None);
    }

    #[test]
    fn parses_every_track_shape() {
        assert_eq!(parse_track("[ahead 3, behind 1]"), (3, 1));
        assert_eq!(parse_track("[ahead 3]"), (3, 0));
        assert_eq!(parse_track("[behind 2]"), (0, 2));
        assert_eq!(parse_track("[gone]"), (0, 0));
        assert_eq!(parse_track(""), (0, 0));
    }

    #[test]
    fn groups_remotes_and_drops_head_pointers() {
        let text = "origin/main\norigin/dev\norigin/HEAD\nupstream/main";
        let groups = group_remotes(text);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].name, "origin");
        assert_eq!(groups[0].branches, vec!["main", "dev"]);
        assert_eq!(groups[1].branches, vec!["main"]);
    }

    #[test]
    fn branch_names_with_slashes_stay_intact() {
        let groups = group_remotes("origin/feature/deep/name");
        assert_eq!(groups[0].branches, vec!["feature/deep/name"]);
    }

    #[test]
    fn parses_stash_list() {
        let stashes = parse_stashes("stash@{0}\tWIP on main: abc123 message\nstash@{1}\tOn dev: x");

        assert_eq!(stashes.len(), 2);
        assert_eq!(stashes[0].selector, "stash@{0}");
        assert_eq!(stashes[0].message, "WIP on main: abc123 message");
    }
}
