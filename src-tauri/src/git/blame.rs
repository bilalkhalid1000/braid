//! Line-by-line authorship for one file.
//!
//! Parsed from `git blame --porcelain`, which states a commit's details once
//! and then refers back to it by hash. That shape is worth preserving all the
//! way to the UI: a long file is usually the work of a few dozen commits, and
//! repeating the author, date and summary on all of ten thousand lines would
//! cost far more to serialize than the blame itself does to compute.

use std::collections::HashMap;

use serde::Serialize;

use super::cli::Git;
use crate::error::Result;


/// A file blamed while it had uncommitted changes reports those lines against
/// the all-zero hash.
const NOT_COMMITTED: &str = "0000000000000000000000000000000000000000";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    pub oid: String,
    pub author: String,
    pub author_mail: String,
    /// Seconds since the epoch, as git reports it.
    pub author_time: i64,
    pub summary: String,
    /// True for the all-zero hash, which means the line is not committed yet.
    pub uncommitted: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub oid: String,
    /// Line number in the file as blamed.
    pub line: u32,
    /// Line number in the commit the line came from, which differs once a file
    /// has been moved around inside itself.
    pub original_line: u32,
    pub content: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub path: String,
    pub lines: Vec<BlameLine>,
    /// Every commit referenced by `lines`, keyed by hash.
    pub commits: HashMap<String, BlameCommit>,
    pub took_ms: u64,
}

/// Blame a path, optionally as it stood at some revision rather than now.
pub async fn blame(git: &Git, path: &str, rev: Option<&str>) -> Result<Blame> {
    let started = std::time::Instant::now();

    // `--` keeps a path that looks like a revision from being read as one, and
    // matters more here than usual because blaming a file called "HEAD" or a
    // branch-shaped path is entirely legitimate.
    let mut args = vec!["blame", "--porcelain"];
    if let Some(rev) = rev {
        args.push(rev);
    }
    args.push("--");
    args.push(path);

    let out = git.run(&args).await?;

    let mut blame = parse(&String::from_utf8_lossy(&out));
    blame.path = path.to_string();
    blame.took_ms = started.elapsed().as_millis() as u64;

    Ok(blame)
}

/// Parse `git blame --porcelain`.
///
/// The format is a header line -- `<hash> <orig-line> <final-line> [<count>]`
/// -- then key/value lines, then the file line itself prefixed with a tab. The
/// key/value block is present only the *first* time a commit appears, so the
/// parser has to carry what it has already learned rather than expecting every
/// entry to describe itself.
fn parse(raw: &str) -> Blame {
    let mut lines = Vec::new();
    let mut commits: HashMap<String, BlameCommit> = HashMap::new();

    let mut oid = String::new();
    let mut original_line = 0u32;
    let mut line_no = 0u32;

    for text in raw.lines() {
        // The content of the line being blamed. A tab, then the line verbatim
        // -- including any tabs of its own, so only the first is ours.
        if let Some(content) = text.strip_prefix('\t') {
            lines.push(BlameLine {
                oid: oid.clone(),
                line: line_no,
                original_line,
                content: content.to_string(),
            });
            continue;
        }

        let (key, value) = text.split_once(' ').unwrap_or((text, ""));

        // A header line starts every entry: the key is a hash rather than a
        // field name.
        if is_hash(key) {
            let mut numbers = value.split(' ');
            oid = key.to_string();
            original_line = numbers.next().and_then(|n| n.parse().ok()).unwrap_or(0);
            line_no = numbers.next().and_then(|n| n.parse().ok()).unwrap_or(0);

            commits.entry(oid.clone()).or_insert_with(|| BlameCommit {
                oid: oid.clone(),
                author: String::new(),
                author_mail: String::new(),
                author_time: 0,
                summary: String::new(),
                uncommitted: oid == NOT_COMMITTED,
            });
            continue;
        }

        let Some(commit) = commits.get_mut(&oid) else {
            continue;
        };

        match key {
            "author" => commit.author = value.to_string(),
            // git wraps the address in angle brackets; nothing downstream wants
            // them, and stripping here keeps every consumer from having to.
            "author-mail" => {
                commit.author_mail = value.trim_matches(|c| c == '<' || c == '>').to_string();
            }
            "author-time" => commit.author_time = value.parse().unwrap_or(0),
            "summary" => commit.summary = value.to_string(),
            _ => {}
        }
    }

    Blame {
        path: String::new(),
        lines,
        commits,
        took_ms: 0,
    }
}

fn is_hash(text: &str) -> bool {
    text.len() == 40 && text.bytes().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two lines from one commit, then a line from another. The second entry
    /// for a commit carries no metadata, which is the point of the format.
    const SAMPLE: &str = "\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 2
author Ada
author-mail <ada@example.com>
author-time 1700000000
author-tz +0000
summary First commit
filename src/main.rs
\tfn main() {
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2 2
\t    println!(\"hi\");
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 3 3 1
author Grace
author-mail <grace@example.com>
author-time 1700000100
author-tz +0000
summary Second commit
filename src/main.rs
\t}
";

    #[test]
    fn every_line_is_attributed() {
        let blame = parse(SAMPLE);

        assert_eq!(blame.lines.len(), 3);
        assert_eq!(blame.lines[0].line, 1);
        assert_eq!(blame.lines[2].line, 3);
        assert!(blame.lines[0].oid.starts_with("aaaa"));
        assert!(blame.lines[2].oid.starts_with("bbbb"));
    }

    #[test]
    fn a_commit_is_described_once_however_many_lines_it_owns() {
        let blame = parse(SAMPLE);

        // Two lines share the first commit, and it appears once.
        assert_eq!(blame.commits.len(), 2);

        let first = &blame.commits[&blame.lines[0].oid];
        assert_eq!(first.author, "Ada");
        assert_eq!(first.summary, "First commit");
    }

    #[test]
    fn a_repeated_commit_keeps_the_details_from_its_first_appearance() {
        let blame = parse(SAMPLE);

        // The second entry for commit "aaaa" carries no author line at all, so
        // this only holds if the parser remembers rather than re-reads.
        let second = &blame.commits[&blame.lines[1].oid];
        assert_eq!(second.author, "Ada");
        assert_eq!(blame.lines[1].content, "    println!(\"hi\");");
    }

    #[test]
    fn the_mail_loses_its_angle_brackets() {
        let blame = parse(SAMPLE);
        assert_eq!(blame.commits[&blame.lines[0].oid].author_mail, "ada@example.com");
    }

    #[test]
    fn content_keeps_its_own_tabs() {
        // Only the first tab is the format's; the rest are the file's
        // indentation and must survive.
        let blame = parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1\n\t\t\tdeep\n");

        assert_eq!(blame.lines[0].content, "\t\tdeep");
    }

    #[test]
    fn an_empty_line_stays_an_empty_line() {
        let blame = parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1\n\t\n");

        assert_eq!(blame.lines.len(), 1);
        assert_eq!(blame.lines[0].content, "");
    }

    #[test]
    fn uncommitted_lines_are_marked_as_such() {
        let raw = format!(
            "{NOT_COMMITTED} 1 1 1\nauthor Not Committed Yet\nauthor-time 0\nsummary x\n\twip\n"
        );
        let blame = parse(&raw);

        assert!(blame.commits[NOT_COMMITTED].uncommitted);
    }

    #[test]
    fn a_line_moved_within_the_file_keeps_both_numbers() {
        // Line 9 of the original ended up as line 3 here, which is what makes
        // the original number worth carrying.
        let blame = parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 9 3 1\n\tmoved\n");

        assert_eq!(blame.lines[0].original_line, 9);
        assert_eq!(blame.lines[0].line, 3);
    }

    #[test]
    fn an_empty_blame_is_not_an_error() {
        assert!(parse("").lines.is_empty());
    }
}
