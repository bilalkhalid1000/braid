use serde::Serialize;

use super::cli::Git;
use super::operation::{self, RepoState};
use crate::error::Result;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Ordinary,
    Renamed,
    Unmerged,
    Untracked,
    Ignored,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    /// Present only for renames and copies.
    pub orig_path: Option<String>,
    /// Porcelain v2 index status char: one of `. M A D R C`.
    pub index_status: String,
    /// Porcelain v2 worktree status char.
    pub worktree_status: String,
    pub kind: EntryKind,
}

impl StatusEntry {
    pub fn is_staged(&self) -> bool {
        self.index_status != "." && self.kind != EntryKind::Untracked
    }

    pub fn is_unstaged(&self) -> bool {
        self.worktree_status != "." || self.kind == EntryKind::Untracked
    }
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    /// Branch name, or `None` when HEAD is detached.
    pub head: Option<String>,
    pub head_oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub entries: Vec<StatusEntry>,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub untracked_count: usize,
    pub conflicted_count: usize,
    /// An operation git has started and not finished, such as the merge a
    /// failed pull leaves behind.
    pub state: RepoState,
    /// How long the underlying git call took. Surfaced in the UI so performance
    /// regressions are visible during development instead of merely felt.
    pub duration_ms: u64,
}

/// Read working-copy status for a repo.
///
/// `--porcelain=v2 -z` is the only status format that is both stable across git
/// versions and unambiguous for paths containing spaces, quotes or newlines.
pub async fn status(git: &Git) -> Result<RepoStatus> {
    let started = std::time::Instant::now();

    // Both reads happen together: the state is part of what the user is
    // looking at, not a separate question asked later.
    let (out, state) = tokio::try_join!(
        git.run(&[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=all",
            "-z",
        ]),
        operation::detect(git),
    )?;

    let mut status = parse(&out);
    status.state = state;
    status.duration_ms = started.elapsed().as_millis() as u64;
    Ok(status)
}

/// Parse `git status --porcelain=v2 -z` output.
///
/// Records are NUL-terminated. Rename and copy records (`2`) are the awkward
/// case: the original path is a *separate* NUL-terminated field following the
/// record, so the reader has to pull an extra token for those.
pub fn parse(buf: &[u8]) -> RepoStatus {
    let mut status = RepoStatus::default();

    let mut records = buf
        .split(|b| *b == 0)
        .filter(|r| !r.is_empty())
        .map(|r| String::from_utf8_lossy(r).into_owned());

    while let Some(rec) = records.next() {
        match rec.as_bytes().first() {
            Some(b'#') => parse_header(&rec, &mut status),

            // Ordinary changed entry:
            // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
            Some(b'1') => {
                if let Some(mut entry) = parse_tracked(&rec, 9) {
                    entry.kind = EntryKind::Ordinary;
                    status.entries.push(entry);
                }
            }

            // Rename or copy:
            // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>
            // followed by a separate NUL-terminated <origPath>.
            Some(b'2') => {
                let orig = records.next();
                if let Some(mut entry) = parse_tracked(&rec, 10) {
                    entry.kind = EntryKind::Renamed;
                    entry.orig_path = orig;
                    status.entries.push(entry);
                }
            }

            // Unmerged:
            // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
            Some(b'u') => {
                if let Some(mut entry) = parse_tracked(&rec, 11) {
                    entry.kind = EntryKind::Unmerged;
                    status.entries.push(entry);
                }
            }

            Some(b'?') => {
                if let Some(path) = rec.get(2..) {
                    status.entries.push(StatusEntry {
                        path: path.to_string(),
                        orig_path: None,
                        index_status: ".".into(),
                        worktree_status: "?".into(),
                        kind: EntryKind::Untracked,
                    });
                }
            }

            Some(b'!') => {
                if let Some(path) = rec.get(2..) {
                    status.entries.push(StatusEntry {
                        path: path.to_string(),
                        orig_path: None,
                        index_status: ".".into(),
                        worktree_status: "!".into(),
                        kind: EntryKind::Ignored,
                    });
                }
            }

            _ => {}
        }
    }

    for entry in &status.entries {
        match entry.kind {
            EntryKind::Unmerged => status.conflicted_count += 1,
            EntryKind::Untracked => status.untracked_count += 1,
            EntryKind::Ignored => {}
            _ => {
                if entry.is_staged() {
                    status.staged_count += 1;
                }
                if entry.is_unstaged() {
                    status.unstaged_count += 1;
                }
            }
        }
    }

    status
}

fn parse_header(rec: &str, status: &mut RepoStatus) {
    let mut parts = rec.splitn(3, ' ');
    let _hash = parts.next();
    let key = parts.next().unwrap_or_default();
    let value = parts.next().unwrap_or_default();

    match key {
        "branch.oid" => {
            if value != "(initial)" {
                status.head_oid = Some(value.to_string());
            }
        }
        "branch.head" => {
            // git reports "(detached)" rather than a name for a detached HEAD.
            if value != "(detached)" {
                status.head = Some(value.to_string());
            }
        }
        "branch.upstream" => status.upstream = Some(value.to_string()),
        "branch.ab" => {
            // Format: "+3 -1"
            let mut ab = value.split(' ');
            status.ahead = ab
                .next()
                .and_then(|v| v.strip_prefix('+'))
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            status.behind = ab
                .next()
                .and_then(|v| v.strip_prefix('-'))
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
        }
        _ => {}
    }
}

/// Shared shape for the `1`, `2` and `u` record types: a fixed number of
/// space-separated fields, then a path that may itself contain spaces.
/// `field_count` includes the path, so `splitn` keeps the path intact.
fn parse_tracked(rec: &str, field_count: usize) -> Option<StatusEntry> {
    let fields: Vec<&str> = rec.splitn(field_count, ' ').collect();
    if fields.len() < field_count {
        return None;
    }

    let xy = fields[1];
    let mut chars = xy.chars();
    let index_status = chars.next()?;
    let worktree_status = chars.next()?;

    Some(StatusEntry {
        path: fields[field_count - 1].to_string(),
        orig_path: None,
        index_status: index_status.to_string(),
        worktree_status: worktree_status.to_string(),
        kind: EntryKind::Ordinary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build NUL-separated input the way git actually emits it.
    fn nul(records: &[&str]) -> Vec<u8> {
        let mut buf = Vec::new();
        for r in records {
            buf.extend_from_slice(r.as_bytes());
            buf.push(0);
        }
        buf
    }

    #[test]
    fn parses_branch_headers() {
        let buf = nul(&[
            "# branch.oid abc123",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +3 -1",
        ]);

        let s = parse(&buf);
        assert_eq!(s.head.as_deref(), Some("main"));
        assert_eq!(s.head_oid.as_deref(), Some("abc123"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!(s.ahead, 3);
        assert_eq!(s.behind, 1);
    }

    #[test]
    fn detached_head_has_no_branch_name() {
        let buf = nul(&["# branch.head (detached)"]);
        assert!(parse(&buf).head.is_none());
    }

    #[test]
    fn parses_ordinary_entry() {
        let buf = nul(&["1 M. N... 100644 100644 100644 aaa bbb src/main.rs"]);
        let s = parse(&buf);

        assert_eq!(s.entries.len(), 1);
        assert_eq!(s.entries[0].path, "src/main.rs");
        assert_eq!(s.entries[0].index_status, "M");
        assert_eq!(s.entries[0].worktree_status, ".");
        assert_eq!(s.staged_count, 1);
        assert_eq!(s.unstaged_count, 0);
    }

    #[test]
    fn path_with_spaces_survives() {
        let buf = nul(&["1 .M N... 100644 100644 100644 aaa bbb my docs/a file.md"]);
        let s = parse(&buf);

        assert_eq!(s.entries[0].path, "my docs/a file.md");
        assert_eq!(s.unstaged_count, 1);
    }

    #[test]
    fn rename_consumes_the_following_orig_path_record() {
        let buf = nul(&[
            "2 R. N... 100644 100644 100644 aaa bbb R100 new/name.rs",
            "old/name.rs",
            "? untracked.txt",
        ]);
        let s = parse(&buf);

        assert_eq!(s.entries.len(), 2);
        assert_eq!(s.entries[0].kind, EntryKind::Renamed);
        assert_eq!(s.entries[0].path, "new/name.rs");
        assert_eq!(s.entries[0].orig_path.as_deref(), Some("old/name.rs"));

        // The orig path must not be mistaken for its own record: if the reader
        // failed to consume it, the untracked entry would be lost or shifted.
        assert_eq!(s.entries[1].kind, EntryKind::Untracked);
        assert_eq!(s.entries[1].path, "untracked.txt");
    }

    #[test]
    fn counts_conflicts_separately() {
        let buf = nul(&["u UU N... 100644 100644 100644 100644 aaa bbb ccc conflicted.rs"]);
        let s = parse(&buf);

        assert_eq!(s.conflicted_count, 1);
        assert_eq!(s.staged_count, 0);
        assert_eq!(s.unstaged_count, 0);
    }

    #[test]
    fn untracked_counts_as_unstaged_work_but_not_staged() {
        let buf = nul(&["? new.txt"]);
        let s = parse(&buf);

        assert_eq!(s.untracked_count, 1);
        assert_eq!(s.staged_count, 0);
        assert!(!s.entries[0].is_staged());
        assert!(s.entries[0].is_unstaged());
    }
}
