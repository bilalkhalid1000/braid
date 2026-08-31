use serde::Serialize;

use super::cli::Git;
use crate::error::Result;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub oid: String,
    pub short: String,
    pub author: String,
    pub email: String,
    /// Author time, seconds since epoch.
    pub timestamp: i64,
    pub parents: Vec<String>,
    /// Decorations git already resolved: branch tips, tags, HEAD.
    pub refs: Vec<String>,
    pub subject: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<Commit>,
    /// False once git returns fewer commits than asked for, which is how the
    /// UI knows to stop requesting more.
    pub has_more: bool,
    pub duration_ms: u64,
}

/// Field and record separators.
///
/// Git's own `%x1f` / `%x1e` are used rather than tabs or newlines because a
/// commit subject may legally contain either, and an author name may contain a
/// tab. These two bytes cannot appear in the fields we request.
const FIELD: char = '\x1f';
const RECORD: char = '\x1e';

const FORMAT: &str = "--format=%H\x1f%h\x1f%an\x1f%ae\x1f%at\x1f%P\x1f%D\x1f%s\x1e";

/// Read one window of history.
///
/// Paging rather than reading the whole log is the point: opening a repo with
/// 200k commits must cost the same as opening one with 20.
pub async fn log(git: &Git, skip: usize, limit: usize) -> Result<LogPage> {
    let started = std::time::Instant::now();

    let text = git
        .run_str_allowing(
            &[
                "log",
                FORMAT,
                // Guarantees no parent is listed before all of its children.
                // The graph's lane assignment depends on that ordering, and
                // plain date order breaks it whenever commit clocks are skewed.
                // Cheaper than --topo-order, which has to buffer the whole walk.
                "--date-order",
                &format!("--skip={skip}"),
                &format!("--max-count={limit}"),
            ],
            // An empty repository has no HEAD to walk, which git calls an error.
            // An empty history is a legitimate state, not a failure.
            &[128],
        )
        .await?;

    let commits = parse(&text);

    Ok(LogPage {
        has_more: commits.len() == limit,
        commits,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

pub fn parse(text: &str) -> Vec<Commit> {
    text.split(RECORD)
        .map(|record| record.trim_start_matches('\n'))
        .filter(|record| !record.is_empty())
        .filter_map(|record| {
            let mut f = record.split(FIELD);

            let oid = f.next()?.to_string();
            let short = f.next()?.to_string();
            let author = f.next()?.to_string();
            let email = f.next()?.to_string();
            let timestamp = f.next()?.parse().unwrap_or(0);
            let parents = f.next()?;
            let refs = f.next()?;
            let subject = f.next().unwrap_or_default().to_string();

            Some(Commit {
                oid,
                short,
                author,
                email,
                timestamp,
                parents: parents
                    .split_whitespace()
                    .map(str::to_string)
                    .collect(),
                refs: refs
                    .split(", ")
                    .filter(|r| !r.is_empty())
                    .map(str::to_string)
                    .collect(),
                subject,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(fields: &[&str]) -> String {
        format!("{}{}", fields.join("\x1f"), RECORD)
    }

    #[test]
    fn parses_a_commit() {
        let text = record(&[
            "abc123def",
            "abc123d",
            "Ada Lovelace",
            "ada@example.com",
            "1700000000",
            "parent1 parent2",
            "HEAD -> main, origin/main",
            "Fix the thing",
        ]);

        let commits = parse(&text);
        assert_eq!(commits.len(), 1);

        let c = &commits[0];
        assert_eq!(c.oid, "abc123def");
        assert_eq!(c.author, "Ada Lovelace");
        assert_eq!(c.timestamp, 1_700_000_000);
        assert_eq!(c.parents, vec!["parent1", "parent2"]);
        assert_eq!(c.refs, vec!["HEAD -> main", "origin/main"]);
        assert_eq!(c.subject, "Fix the thing");
    }

    #[test]
    fn root_commit_has_no_parents() {
        let text = record(&["a", "a", "N", "e", "1", "", "", "init"]);
        assert!(parse(&text)[0].parents.is_empty());
    }

    #[test]
    fn undecorated_commit_has_no_refs() {
        let text = record(&["a", "a", "N", "e", "1", "p", "", "work"]);
        assert!(parse(&text)[0].refs.is_empty());
    }

    #[test]
    fn subject_containing_a_newline_stays_in_one_commit() {
        // git separates records itself, so a multi-line subject must not be
        // mistaken for the start of the next commit.
        let text = format!(
            "{}{}",
            record(&["a", "a", "N", "e", "1", "p", "", "line one\nline two"]),
            record(&["b", "b", "N", "e", "2", "a", "", "second"])
        );

        let commits = parse(&text);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "line one\nline two");
        assert_eq!(commits[1].oid, "b");
    }

    #[test]
    fn empty_output_yields_no_commits() {
        assert!(parse("").is_empty());
    }
}
