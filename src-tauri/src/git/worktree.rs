use serde::Serialize;

use super::cli::Git;
use crate::error::Result;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub head: Option<String>,
    /// Short branch name, or `None` when the worktree has a detached HEAD.
    pub branch: Option<String>,
    pub is_bare: bool,
    pub is_detached: bool,
    pub is_locked: bool,
    pub lock_reason: Option<String>,
    /// Git considers this worktree removable: its directory is gone.
    pub prunable: bool,
    /// The repository's own worktree, which cannot be removed.
    pub is_main: bool,
}

pub async fn list(git: &Git) -> Result<Vec<Worktree>> {
    // `--porcelain` is the only stable format; the human-readable one aligns
    // columns with spaces and cannot be parsed for paths containing spaces.
    let text = git.run_str(&["worktree", "list", "--porcelain"]).await?;
    Ok(parse(&text))
}

/// Parse `git worktree list --porcelain`.
///
/// Records are separated by a blank line. Each starts with a `worktree <path>`
/// line, followed by attribute lines that are either `key value` or a bare
/// `key` flag.
pub fn parse(text: &str) -> Vec<Worktree> {
    let mut worktrees: Vec<Worktree> = Vec::new();

    for line in text.lines() {
        let (key, value) = match line.split_once(' ') {
            Some((k, v)) => (k, Some(v)),
            None => (line, None),
        };

        if key == "worktree" {
            worktrees.push(Worktree {
                path: value.unwrap_or_default().replace('\\', "/"),
                // Git always lists the repository's own worktree first.
                is_main: worktrees.is_empty(),
                ..Default::default()
            });
            continue;
        }

        let Some(current) = worktrees.last_mut() else {
            continue;
        };

        match key {
            "HEAD" => current.head = value.map(str::to_string),
            "branch" => {
                // Reported as a full ref: refs/heads/feature/thing.
                current.branch = value.map(|v| v.trim_start_matches("refs/heads/").to_string());
            }
            "bare" => current.is_bare = true,
            "detached" => current.is_detached = true,
            "locked" => {
                current.is_locked = true;
                // The reason is optional; `locked` may appear on its own.
                current.lock_reason = value.map(str::to_string);
            }
            "prunable" => current.prunable = true,
            _ => {}
        }
    }

    worktrees
}

/// Create a worktree.
///
/// `new_branch` decides whether `branch` names an existing ref to check out or
/// a branch to create at the current HEAD. Getting this backwards is the most
/// common way a worktree command fails, so it is an explicit choice rather
/// than something inferred.
pub async fn add(git: &Git, path: &str, branch: &str, new_branch: bool) -> Result<String> {
    let mut args = vec!["worktree", "add"];

    if new_branch {
        args.push("-b");
        args.push(branch);
        args.push(path);
    } else {
        args.push(path);
        args.push(branch);
    }

    git.run_reported(&args).await
}

pub async fn remove(git: &Git, path: &str, force: bool) -> Result<String> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(path);

    git.run_reported(&args).await
}

/// Drop administrative records for worktrees whose directories are gone.
pub async fn prune(git: &Git) -> Result<String> {
    git.run_reported(&["worktree", "prune", "-v"]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = concat!(
        "worktree C:/repos/app\n",
        "HEAD abc123\n",
        "branch refs/heads/main\n",
        "\n",
        "worktree C:/repos/app-feature\n",
        "HEAD def456\n",
        "branch refs/heads/feature/login\n",
        "\n",
        "worktree C:/repos/app-detached\n",
        "HEAD 789abc\n",
        "detached\n",
    );

    #[test]
    fn parses_every_worktree() {
        let list = parse(SAMPLE);
        assert_eq!(list.len(), 3);
    }

    #[test]
    fn first_entry_is_the_main_worktree() {
        let list = parse(SAMPLE);
        assert!(list[0].is_main);
        assert!(!list[1].is_main);
        assert!(!list[2].is_main);
    }

    #[test]
    fn strips_the_refs_heads_prefix_from_branches() {
        let list = parse(SAMPLE);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        // A branch name containing a slash must survive intact.
        assert_eq!(list[1].branch.as_deref(), Some("feature/login"));
    }

    #[test]
    fn detached_worktree_has_no_branch() {
        let list = parse(SAMPLE);
        assert!(list[2].is_detached);
        assert!(list[2].branch.is_none());
        assert_eq!(list[2].head.as_deref(), Some("789abc"));
    }

    #[test]
    fn reads_lock_reason_when_present_and_bare_flag() {
        let text = concat!(
            "worktree C:/repos/bare\n",
            "bare\n",
            "\n",
            "worktree C:/repos/held\n",
            "HEAD abc\n",
            "detached\n",
            "locked on a removable drive\n",
            "prunable gitdir file points to non-existent location\n",
        );

        let list = parse(text);
        assert!(list[0].is_bare);
        assert!(list[1].is_locked);
        assert_eq!(list[1].lock_reason.as_deref(), Some("on a removable drive"));
        assert!(list[1].prunable);
    }

    #[test]
    fn bare_locked_flag_without_a_reason_still_locks() {
        let text = "worktree C:/repos/x\nHEAD abc\nlocked\n";
        let list = parse(text);

        assert!(list[0].is_locked);
        assert!(list[0].lock_reason.is_none());
    }

    #[test]
    fn paths_containing_spaces_are_kept_whole() {
        let text = "worktree C:/my repos/the app\nHEAD abc\nbranch refs/heads/main\n";
        assert_eq!(parse(text)[0].path, "C:/my repos/the app");
    }
}
