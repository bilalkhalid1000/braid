//! How much housekeeping a repository's object store needs, and doing it.
//!
//! Git packs its objects on its own now and then (`gc.auto`), but only when a
//! command that writes happens to check, and a clone that is fetched into and
//! committed to for years from several tools can still end up with thousands
//! of loose objects, dozens of packs and the leftovers of interrupted fetches.
//! On Windows every loose object is a file opened on its own, and one such
//! repository took eight seconds to read a page of history cold -- about fifty
//! times what it took once the same objects were packed.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use super::cli::Git;
use crate::error::Result;

/// Git's own threshold for packing loose objects (`gc.auto`).
const LOOSE_LIMIT: u64 = 6700;
/// Git's own threshold for consolidating packs (`gc.autoPackLimit`).
const PACK_LIMIT: u64 = 50;

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoHealth {
    /// Objects stored one file each.
    pub loose: u64,
    pub loose_kib: u64,
    pub packs: u64,
    pub pack_kib: u64,
    /// Files in the object store that are not objects: half-written packs
    /// from an interrupted fetch, indexes whose pack is gone.
    pub garbage: u64,
    pub garbage_kib: u64,
    /// Why a clean-up is worth it, in words; empty when it is not.
    pub reasons: Vec<String>,
}

impl RepoHealth {
    pub fn total_kib(&self) -> u64 {
        self.loose_kib + self.pack_kib + self.garbage_kib
    }
}

/// How old a temporary file in the object store has to be before `git gc`
/// removes it: `gc.pruneExpire`'s default. Younger ones may belong to a fetch
/// that is still running, and git leaves them be.
const TEMP_EXPIRY: Duration = Duration::from_secs(14 * 24 * 60 * 60);

/// Read the object store's counts.
///
/// Leftover files are counted only where a clean-up removes them. Git's own
/// count takes in temporary files younger than two weeks, which `gc` keeps on
/// purpose, and files it does not recognise, which it never touches -- so
/// the button asked to be pressed, was pressed, and went on asking.
pub async fn health(git: &Git) -> Result<RepoHealth> {
    let (text, warnings) = git.run_both(&["count-objects", "-v"]).await?;
    let mut health = parse(&text);

    let now = SystemTime::now();
    let removable: Vec<PathBuf> = leftovers(&warnings)
        .into_iter()
        .map(|(path, kind)| (git.workdir().join(path), kind))
        .filter(|(path, kind)| match kind {
            Leftover::Orphan => true,
            Leftover::Temporary => std::fs::metadata(path)
                .and_then(|m| m.modified())
                .is_ok_and(|at| now.duration_since(at).unwrap_or_default() >= TEMP_EXPIRY),
            Leftover::Unknown => false,
        })
        .map(|(path, _)| path)
        .collect();

    health.garbage = removable.len() as u64;
    health.garbage_kib = removable
        .iter()
        .filter_map(|path| std::fs::metadata(path).ok())
        .map(|m| m.len().div_ceil(1024))
        .sum();
    health.reasons = reasons(&health);
    Ok(health)
}

/// A file `count-objects -v` reported as not belonging in the object store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Leftover {
    /// Half of a pack, the other half gone. `gc` removes it.
    Orphan,
    /// A `tmp_` file from a write that never finished. `gc` removes it once
    /// it is old enough.
    Temporary,
    /// Anything else. `gc` leaves it alone.
    Unknown,
}

/// The leftover files git named in its warnings, as it wrote their paths:
/// `warning: garbage found: <path>` and `warning: no corresponding .pack: <path>`.
fn leftovers(warnings: &str) -> Vec<(&str, Leftover)> {
    warnings
        .lines()
        .filter_map(|line| line.trim().strip_prefix("warning: "))
        .filter_map(|rest| {
            if let Some(path) = rest.strip_prefix("garbage found: ") {
                let name = Path::new(path).file_name()?.to_string_lossy();
                let kind = if name.starts_with("tmp_") {
                    Leftover::Temporary
                } else {
                    Leftover::Unknown
                };
                Some((path, kind))
            } else if rest.starts_with("no corresponding .") {
                Some((rest.split_once(": ")?.1, Leftover::Orphan))
            } else {
                None
            }
        })
        .collect()
}

/// Pack loose objects, merge packs, and drop what nothing refers to.
///
/// Plain `git gc`, with git's own safety margin: unreachable objects younger
/// than two weeks are kept, so nothing another process has only just written
/// can be lost. Returns what changed, in the counts the question was asked in.
pub async fn gc(git: &Git) -> Result<String> {
    let before = health(git).await?;
    git.run(&["gc", "--quiet"]).await?;
    let after = health(git).await?;
    Ok(summary(&before, &after))
}

fn parse(text: &str) -> RepoHealth {
    let mut health = RepoHealth::default();

    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let Ok(value) = value.trim().parse::<u64>() else {
            continue;
        };
        match key.trim() {
            "count" => health.loose = value,
            "size" => health.loose_kib = value,
            "packs" => health.packs = value,
            "size-pack" => health.pack_kib = value,
            "garbage" => health.garbage = value,
            "size-garbage" => health.garbage_kib = value,
            _ => {}
        }
    }

    health.reasons = reasons(&health);
    health
}

fn reasons(health: &RepoHealth) -> Vec<String> {
    let mut out = Vec::new();

    if health.loose >= LOOSE_LIMIT {
        out.push(format!(
            "{} objects are stored loose, one file each. Git packs them itself past {LOOSE_LIMIT}, but only when a command happens to check.",
            health.loose
        ));
    }
    if health.packs >= PACK_LIMIT {
        out.push(format!(
            "History is split across {} packs, and every read searches each of them.",
            health.packs
        ));
    }
    if health.garbage > 0 {
        out.push(format!(
            "{} leftover {} in the object store, from fetches or clean-ups that were interrupted.",
            health.garbage,
            if health.garbage == 1 { "file" } else { "files" }
        ));
    }

    out
}

fn summary(before: &RepoHealth, after: &RepoHealth) -> String {
    format!(
        "Loose objects {} → {}, packs {} → {}, leftover files {} → {}. Object store {} → {}.",
        before.loose,
        after.loose,
        before.packs,
        after.packs,
        before.garbage,
        after.garbage,
        size(before.total_kib()),
        size(after.total_kib()),
    )
}

/// A size in KiB, the way a person would say it.
pub fn size(kib: u64) -> String {
    if kib >= 1024 * 1024 {
        format!("{:.1} GB", kib as f64 / (1024.0 * 1024.0))
    } else if kib >= 1024 {
        format!("{:.1} MB", kib as f64 / 1024.0)
    } else {
        format!("{kib} KB")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What `count-objects -v` printed for the repository that prompted this.
    const CLUTTERED: &str = "count: 12017\nsize: 34223\nin-pack: 103158\npacks: 46\nsize-pack: 81234\nprune-packable: 12\ngarbage: 58\nsize-garbage: 20480\n";

    #[test]
    fn reads_the_counts() {
        let health = parse(CLUTTERED);
        assert_eq!(health.loose, 12017);
        assert_eq!(health.loose_kib, 34223);
        assert_eq!(health.packs, 46);
        assert_eq!(health.pack_kib, 81234);
        assert_eq!(health.garbage, 58);
        assert_eq!(health.garbage_kib, 20480);
    }

    #[test]
    fn a_cluttered_store_says_why() {
        let reasons = parse(CLUTTERED).reasons;
        assert_eq!(reasons.len(), 2, "{reasons:?}");
        assert!(reasons[0].starts_with("12017 objects are stored loose"));
        assert!(reasons[1].starts_with("58 leftover files"));
    }

    #[test]
    fn a_tidy_store_asks_for_nothing() {
        let health = parse("count: 12\nsize: 48\nin-pack: 900\npacks: 1\nsize-pack: 400\nprune-packable: 0\ngarbage: 0\nsize-garbage: 0\n");
        assert!(health.reasons.is_empty());
    }

    #[test]
    fn many_packs_is_a_reason_on_its_own() {
        let health = parse("count: 0\npacks: 50\ngarbage: 0\n");
        assert_eq!(health.reasons.len(), 1);
    }

    #[test]
    fn leftovers_are_sorted_by_whether_a_clean_up_removes_them() {
        let warnings = concat!(
            "warning: garbage found: .git/objects/pack/tmp_pack_Ab12\n",
            "warning: garbage found: .git/objects/pack/notes.txt\n",
            "warning: no corresponding .pack: .git/objects/pack/pack-00ff.idx\n",
            "warning: in the working copy of 'f1', LF will be replaced by CRLF\n",
        );

        assert_eq!(
            leftovers(warnings),
            vec![
                (".git/objects/pack/tmp_pack_Ab12", Leftover::Temporary),
                (".git/objects/pack/notes.txt", Leftover::Unknown),
                (".git/objects/pack/pack-00ff.idx", Leftover::Orphan),
            ]
        );
    }

    #[test]
    fn sizes_read_as_a_person_would_say_them() {
        assert_eq!(size(512), "512 KB");
        assert_eq!(size(34223), "33.4 MB");
        assert_eq!(size(3 * 1024 * 1024), "3.0 GB");
    }
}
