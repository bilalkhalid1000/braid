//! Rewriting a run of commits: reorder, reword, squash, fixup, drop, edit.
//!
//! Git's interactive rebase is driven by a todo file it hands to an editor.
//! The editor here is `cp`, copying a todo written in advance, so the whole
//! plan is decided in the UI and git only executes it. Rewording goes through
//! an `exec` line that amends from a message file rather than through
//! `GIT_EDITOR`, which one environment variable could not vary per commit.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::fs;

use super::cli::Git;
use crate::error::{AppError, Result};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanCommit {
    pub oid: String,
    pub short: String,
    pub subject: String,
    /// The whole message, for rewording.
    pub message: String,
}

/// The commits an interactive rebase from a point would replay, and what
/// replaying them costs.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlan {
    /// What the run is replayed onto: the parent of the first commit.
    pub base: String,
    /// Oldest first, the order git's todo uses.
    pub commits: Vec<PlanCommit>,
    pub upstream: Option<String>,
    /// How many of the commits the upstream already has. Non-zero means the
    /// rewrite needs a force push and anyone who pulled keeps the old ones.
    pub published: usize,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub action: Action,
    pub oid: String,
    /// The new message, for a reword. Ignored elsewhere.
    pub message: Option<String>,
}

/// Field and record separators git will never print inside a message.
const FIELD: &str = "\x1f";
const RECORD: &str = "\x1e";

/// The commits from `from` up to HEAD, ready to be rewritten.
pub async fn plan(git: &Git, from: &str) -> Result<RebasePlan> {
    let reachable = git
        .run(&["merge-base", "--is-ancestor", from, "HEAD"])
        .await
        .is_ok();
    if !reachable {
        return Err(AppError::Git {
            code: 1,
            stderr: "That commit is not on the branch you have checked out.".into(),
        });
    }

    let base = git
        .run_str_allowing(
            &["rev-parse", "--verify", "--quiet", &format!("{from}^1")],
            &[1],
        )
        .await?;
    if base.is_empty() {
        return Err(AppError::Git {
            code: 1,
            stderr: "This is the first commit in the repository, so there is nothing to rebase \
                     the rest onto."
                .into(),
        });
    }

    let range = format!("{base}..HEAD");
    let format = format!("--format=%H{FIELD}%h{FIELD}%P{FIELD}%s{FIELD}%B{RECORD}");
    let log = git.run_str(&["log", "--reverse", &format, &range]).await?;

    let mut commits = Vec::new();
    for record in log.split(RECORD) {
        let record = record.trim_start_matches('\n');
        if record.trim().is_empty() {
            continue;
        }
        let mut fields = record.split(FIELD);
        let oid = fields.next().unwrap_or_default().to_string();
        let short = fields.next().unwrap_or_default().to_string();
        let parents = fields.next().unwrap_or_default();
        let subject = fields.next().unwrap_or_default().to_string();
        let message = fields.next().unwrap_or_default().trim_end().to_string();

        // A plain rebase flattens merges by dropping them, which is not what
        // anyone rearranging a few commits meant. Refuse rather than surprise.
        if parents.split_whitespace().count() > 1 {
            return Err(AppError::Git {
                code: 1,
                stderr: format!(
                    "{short} is a merge. Rebasing across a merge would drop it; pick a later \
                     starting point."
                ),
            });
        }

        commits.push(PlanCommit {
            oid,
            short,
            subject,
            message,
        });
    }

    let impact = super::reset::impact(git, &base).await?;

    Ok(RebasePlan {
        base,
        commits,
        upstream: impact.upstream,
        published: impact.published,
    })
}

/// A path git's `sh` will read back the same on every platform.
fn shell_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// The todo git would have asked an editor for, written from the steps.
///
/// Files for reworded messages go beside it; the returned lines refer to them
/// by absolute path, because the exec runs inside `.git/rebase-merge`.
async fn write_todo(dir: &Path, steps: &[Step]) -> Result<PathBuf> {
    let mut todo = String::new();

    for (i, step) in steps.iter().enumerate() {
        let verb = match step.action {
            Action::Pick => "pick",
            Action::Edit => "edit",
            Action::Squash => "squash",
            Action::Fixup => "fixup",
            Action::Drop => "drop",
            // Picked, then amended from a file: the message is decided here,
            // not typed into whatever editor git would have opened.
            Action::Reword => "pick",
        };
        todo.push_str(&format!("{verb} {}\n", step.oid));

        if step.action == Action::Reword {
            let file = dir.join(format!("message-{i}"));
            let message = step.message.clone().unwrap_or_default();
            fs::write(&file, message.trim_end().to_string() + "\n").await?;
            todo.push_str(&format!(
                "exec git commit --amend -F \"{}\"\n",
                shell_path(&file)
            ));
        }
    }

    let path = dir.join("todo");
    fs::write(&path, todo).await?;
    Ok(path)
}

/// Replay the commits after `base` as `steps` says.
///
/// A conflict, or an `edit`, leaves the repository mid-rebase, which the
/// operation banner already knows how to continue or abort.
pub async fn run(git: &Git, base: &str, steps: &[Step]) -> Result<String> {
    if steps.iter().all(|step| step.action == Action::Drop) {
        return Err(AppError::Git {
            code: 1,
            stderr:
                "Every commit is dropped. Reset to the base instead; that is what this would do."
                    .into(),
        });
    }

    let dir = std::env::temp_dir().join(format!(
        "braid-rebase-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default()
    ));
    fs::create_dir_all(&dir).await?;

    let todo = write_todo(&dir, steps).await?;

    let result = git
        .run_reported_env(
            // Autostash, so unstaged work in the tree does not stop a rebase
            // that never touches it; git puts it back afterwards.
            &["rebase", "--interactive", "--autostash", base],
            &[
                (
                    "GIT_SEQUENCE_EDITOR",
                    format!("cp \"{}\"", shell_path(&todo)),
                ),
                // A squash opens an editor on the joined messages; accepting
                // them as they are is what "squash" means here.
                ("GIT_EDITOR", "true".to_string()),
            ],
        )
        .await;

    // ponytail: the files stay while a rebase is stopped, because its later
    // exec lines still read them. A finished one, either way, has no use for
    // them. Stopped rebases that are then aborted leak a few bytes in the
    // temp dir until the OS clears it.
    if result.is_ok() || !stopped(git).await {
        let _ = fs::remove_dir_all(&dir).await;
    }

    let kept = steps.iter().filter(|s| s.action != Action::Drop).count();
    result.map(|out| {
        if out.trim().is_empty() {
            format!("Rewrote {kept} commit{}", if kept == 1 { "" } else { "s" })
        } else {
            out
        }
    })
}

async fn stopped(git: &Git) -> bool {
    matches!(
        super::operation::detect(git).await,
        Ok(super::operation::RepoState::Rebasing)
    )
}

/// Fold what is staged into an older commit.
///
/// The staged changes become a fixup commit, and a rebase from the target
/// folds it in right after, leaving the message alone -- the same thing as
/// amending HEAD, reached further back.
pub async fn amend_into(git: &Git, oid: &str) -> Result<String> {
    // Exit 1 from `--quiet` means there is a difference, which is the case
    // with something to amend with.
    let staged = git.run(&["diff", "--cached", "--quiet"]).await.is_err();
    if !staged {
        return Err(AppError::Git {
            code: 1,
            stderr: "Nothing is staged. Stage the changes to fold in first.".into(),
        });
    }

    let plan = plan(git, oid).await?;

    git.run_reported(&["commit", "--fixup", oid]).await?;
    let fixup = git.run_str(&["rev-parse", "HEAD"]).await?;

    let mut steps = Vec::with_capacity(plan.commits.len() + 1);
    for commit in &plan.commits {
        steps.push(Step {
            action: Action::Pick,
            oid: commit.oid.clone(),
            message: None,
        });
        if commit.oid == oid {
            steps.push(Step {
                action: Action::Fixup,
                oid: fixup.clone(),
                message: None,
            });
        }
    }

    run(git, &plan.base, &steps).await?;
    Ok(format!("Amended {}", &oid[..oid.len().min(8)]))
}
