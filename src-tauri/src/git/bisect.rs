//! Finding the commit that broke something, by halving.
//!
//! Git keeps the whole state under `refs/bisect/`: one `bad`, a `good-<oid>`
//! per good mark and a `skip-<oid>` per skip. Reading those back is what
//! lets the history show the marks; the arithmetic on what is left is git's
//! own, from `rev-list --bisect-vars`.

use serde::{Deserialize, Serialize};

use super::cli::Git;
use crate::error::Result;

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BisectStatus {
    pub active: bool,
    pub bad: Option<String>,
    pub good: Vec<String>,
    pub skipped: Vec<String>,
    /// Commits still to test, once both ends are marked.
    pub remaining: Option<u32>,
    /// Roughly how many more marks that takes.
    pub steps: Option<u32>,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Good,
    Bad,
    Skip,
}

impl Verdict {
    fn word(self) -> &'static str {
        match self {
            Verdict::Good => "good",
            Verdict::Bad => "bad",
            Verdict::Skip => "skip",
        }
    }
}

pub async fn status(git: &Git) -> Result<BisectStatus> {
    let start = git.run_str(&["rev-parse", "--git-path", "BISECT_START"]).await?;
    let active = tokio::fs::try_exists(git.workdir().join(start.trim()))
        .await
        .unwrap_or(false);
    if !active {
        return Ok(BisectStatus::default());
    }

    let refs = git
        .run_str(&["for-each-ref", "--format=%(refname)\t%(objectname)", "refs/bisect/"])
        .await?;

    let mut status = BisectStatus { active: true, ..Default::default() };
    for line in refs.lines() {
        let Some((name, oid)) = line.split_once('\t') else {
            continue;
        };
        let name = name.trim_start_matches("refs/bisect/");
        if name == "bad" {
            status.bad = Some(oid.to_string());
        } else if name.starts_with("good-") {
            status.good.push(oid.to_string());
        } else if name.starts_with("skip-") {
            status.skipped.push(oid.to_string());
        }
    }

    if status.bad.is_some() && !status.good.is_empty() {
        let mut args = vec!["rev-list", "--bisect-vars", "refs/bisect/bad", "--not"];
        let goods: Vec<String> = status.good.iter().map(|g| format!("refs/bisect/good-{g}")).collect();
        args.extend(goods.iter().map(String::as_str));

        // Prints shell assignments: bisect_nr=3, bisect_steps=2, and so on.
        if let Ok(vars) = git.run_str(&args).await {
            for line in vars.lines() {
                if let Some(n) = line.strip_prefix("bisect_nr=") {
                    status.remaining = n.trim().parse().ok();
                } else if let Some(n) = line.strip_prefix("bisect_steps=") {
                    status.steps = n.trim().parse().ok();
                }
            }
        }
    }

    Ok(status)
}

/// Mark a commit, starting the bisect first when none is running.
///
/// Git moves HEAD to the next commit to test as soon as it has both ends,
/// and says how many are left; that message is the result.
pub async fn mark(git: &Git, verdict: Verdict, oid: &str) -> Result<String> {
    if !status(git).await?.active {
        git.run_reported(&["bisect", "start"]).await?;
    }

    let out = git.run_reported(&["bisect", verdict.word(), oid]).await?;
    Ok(if out.trim().is_empty() {
        format!("Marked {} {}", &oid[..oid.len().min(8)], verdict.word())
    } else {
        out
    })
}

/// Stop, and go back to where the bisect started.
pub async fn reset(git: &Git) -> Result<String> {
    git.run_reported(&["bisect", "reset"]).await
}
