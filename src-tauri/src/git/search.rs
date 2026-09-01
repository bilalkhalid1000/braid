//! Searching a repository three ways, because "where is that" has three
//! different answers depending on what you are looking for: a commit that
//! changed something, a line of code, or a file.
//!
//! Each is a thin wrapper over the git that already does it well. Nothing here
//! reimplements matching — `git log --grep` and `git grep` are faster than
//! anything walking the tree from the outside, and they already agree with the
//! user's own git about what a repository contains.

use serde::Serialize;

use super::cli::Git;
use super::log::{self, Commit};
use crate::error::Result;


/// Stop at this many. A search is for finding something, not for reading
/// everything; past a screenful the answer is "narrow it", and paging a result
/// set nobody scrolls costs more than it returns.
const LIMIT: usize = 200;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodeHit {
    pub path: String,
    pub line: u32,
    /// The matching line, as it is in the file.
    pub text: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub commits: Vec<Commit>,
    pub code: Vec<CodeHit>,
    pub files: Vec<String>,
    /// True where a list was cut at the limit, so the UI can say so rather
    /// than implying that is all there is.
    pub truncated: bool,
    pub duration_ms: u64,
}

#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchKind {
    Commits,
    Code,
    Files,
}

/// Search the repository.
///
/// One entry point rather than three commands, because the query is one thing
/// and only the kind changes — which keeps the caller from having to know which
/// of three shapes it is asking for.
pub async fn search(git: &Git, query: &str, kind: SearchKind) -> Result<SearchResults> {
    let started = std::time::Instant::now();
    let query = query.trim();

    let mut results = SearchResults::default();

    if query.is_empty() {
        return Ok(results);
    }

    match kind {
        SearchKind::Commits => {
            let (commits, truncated) = commits(git, query).await?;
            results.commits = commits;
            results.truncated = truncated;
        }
        SearchKind::Code => {
            let (code, truncated) = code(git, query).await?;
            results.code = code;
            results.truncated = truncated;
        }
        SearchKind::Files => {
            let (files, truncated) = files(git, query).await?;
            results.files = files;
            results.truncated = truncated;
        }
    }

    results.duration_ms = started.elapsed().as_millis() as u64;
    Ok(results)
}

/// Commits whose message or author matches.
///
/// Two walks, merged. git ANDs `--author` with `--grep` -- asking for both in
/// one command means "by this person AND mentioning this word", which for a
/// single query typed into a box matches almost nothing. Running them
/// separately and merging is what actually gives "either".
async fn commits(git: &Git, query: &str) -> Result<(Vec<Commit>, bool)> {
    let by_message = walk(git, &format!("--grep={query}")).await?;
    let by_author = walk(git, &format!("--author={query}")).await?;

    let mut found = by_message;
    let mut seen: std::collections::HashSet<String> =
        found.iter().map(|c| c.oid.clone()).collect();

    for commit in by_author {
        if seen.insert(commit.oid.clone()) {
            found.push(commit);
        }
    }

    // Each walk came back newest first; merged they interleave, so the order
    // has to be restored or the results read as unsorted.
    found.sort_by_key(|commit| std::cmp::Reverse(commit.timestamp));

    let truncated = found.len() > LIMIT;
    found.truncate(LIMIT);

    Ok((found, truncated))
}

/// One `git log` walk with a single limiting pattern.
async fn walk(git: &Git, pattern: &str) -> Result<Vec<Commit>> {
    let text = git
        .run_str_allowing(
            &[
                "log",
                log::FORMAT,
                "--date-order",
                "--regexp-ignore-case",
                // Fixed strings, not regex: a query typed into a search box is
                // a thing to find, and `fix(parser)` should not be a group.
                "--fixed-strings",
                pattern,
                &format!("--max-count={}", LIMIT + 1),
                "--all",
            ],
            // No HEAD to walk is an empty repository, not a failure.
            &[128],
        )
        .await?;

    Ok(log::parse(&text))
}

/// Lines in the working tree that contain the query.
async fn code(git: &Git, query: &str) -> Result<(Vec<CodeHit>, bool)> {
    let text = git
        .run_str_allowing(
            &[
                "grep",
                "--line-number",
                "--ignore-case",
                "--fixed-strings",
                // Binary files have no lines worth showing, and their contents
                // would arrive as noise.
                "-I",
                "--no-color",
                &format!("--max-count={}", LIMIT + 1),
                "-e",
                query,
            ],
            // git grep exits 1 when nothing matched, which is an answer.
            &[1],
        )
        .await?;

    let mut hits: Vec<CodeHit> = text.lines().filter_map(parse_grep_line).collect();
    let truncated = hits.len() > LIMIT;
    hits.truncate(LIMIT);

    Ok((hits, truncated))
}

/// Tracked files whose path contains the query.
async fn files(git: &Git, query: &str) -> Result<(Vec<String>, bool)> {
    let text = git.run_str(&["ls-files"]).await?;
    let needle = query.to_lowercase();

    let mut found: Vec<String> = text
        .lines()
        .filter(|path| path.to_lowercase().contains(&needle))
        .map(str::to_string)
        .collect();

    let truncated = found.len() > LIMIT;
    found.truncate(LIMIT);

    Ok((found, truncated))
}

/// Read one line of `git grep --line-number` output: `path:line:text`.
///
/// Split twice from the left and no further: a path can contain a colon on
/// every platform git runs on, and the text certainly can — splitting on all
/// of them would cut a match containing `::` into pieces.
fn parse_grep_line(line: &str) -> Option<CodeHit> {
    let (path, rest) = line.split_once(':')?;
    let (number, text) = rest.split_once(':')?;

    Some(CodeHit {
        path: path.to_string(),
        line: number.parse().ok()?,
        text: text.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_grep_line() {
        let hit = parse_grep_line("src/main.rs:42:    let x = 1;").unwrap();

        assert_eq!(hit.path, "src/main.rs");
        assert_eq!(hit.line, 42);
        assert_eq!(hit.text, "    let x = 1;");
    }

    #[test]
    fn keeps_colons_that_belong_to_the_match() {
        // Rust paths, TypeScript types, URLs -- a match with colons in it is
        // the normal case, not the exception.
        let hit = parse_grep_line("src/lib.rs:7:use std::collections::HashMap;").unwrap();

        assert_eq!(hit.line, 7);
        assert_eq!(hit.text, "use std::collections::HashMap;");
    }

    #[test]
    fn keeps_the_leading_whitespace_of_a_line() {
        // Indentation is how you tell where a hit sits in a file.
        let hit = parse_grep_line("a.py:3:        return None").unwrap();

        assert_eq!(hit.text, "        return None");
    }

    #[test]
    fn ignores_a_line_that_is_not_a_hit() {
        assert!(parse_grep_line("").is_none());
        assert!(parse_grep_line("no colons here").is_none());
        assert!(parse_grep_line("path:notanumber:text").is_none());
    }

    #[test]
    fn reads_an_empty_matching_line() {
        let hit = parse_grep_line("a.txt:9:").unwrap();

        assert_eq!(hit.line, 9);
        assert_eq!(hit.text, "");
    }
}
