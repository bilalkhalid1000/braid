use serde::Serialize;

use super::cli::Git;
use crate::error::Result;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    /// Present when the file was renamed or copied.
    pub old_path: Option<String>,
    pub additions: u32,
    pub deletions: u32,
    /// Git reports no line counts for a binary file, only that it changed.
    pub binary: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub oid: String,
    pub short: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub subject: String,
    /// Everything after the subject line, already unwrapped by git.
    pub body: String,
    pub parents: Vec<String>,
    pub files: Vec<FileStat>,
    pub additions: u32,
    pub deletions: u32,
    pub duration_ms: u64,
}

const FIELD: char = '\x1f';
const METADATA_FORMAT: &str = "--format=%H\x1f%h\x1f%an\x1f%ae\x1f%at\x1f%P\x1f%s\x1f%b";

/// Read one commit: who wrote it, what it says, and which files it touched.
///
/// The file list comes from `--numstat` rather than `--stat`, because `--stat`
/// is a rendered picture — padded columns, paths abbreviated to fit, and a bar
/// capped at a fixed width — and a picture cannot be laid out to the width of
/// the pane it lands in. Numbers can.
pub async fn detail(git: &Git, oid: &str) -> Result<CommitDetail> {
    let started = std::time::Instant::now();

    // Bound to a local rather than written inline: an array literal passed
    // straight into an await would be dropped while still borrowed.
    let metadata_args = ["show", "--no-patch", METADATA_FORMAT, oid];
    let metadata = git.run_str(&metadata_args).await?;

    let mut detail = parse_metadata(&metadata);

    let base = first_parent(git, oid).await?;
    let numstat = numstat_args(&base, oid);
    let numstat: Vec<&str> = numstat.iter().map(String::as_str).collect();

    detail.files = parse_numstat(&git.run_str(&numstat).await?);

    detail.additions = detail.files.iter().map(|f| f.additions).sum();
    detail.deletions = detail.files.iter().map(|f| f.deletions).sum();
    detail.duration_ms = started.elapsed().as_millis() as u64;

    Ok(detail)
}

pub fn parse_metadata(text: &str) -> CommitDetail {
    let mut fields = text.split(FIELD);

    let mut detail = CommitDetail {
        oid: fields.next().unwrap_or_default().trim().to_string(),
        short: fields.next().unwrap_or_default().to_string(),
        author: fields.next().unwrap_or_default().to_string(),
        email: fields.next().unwrap_or_default().to_string(),
        timestamp: fields.next().unwrap_or_default().parse().unwrap_or(0),
        ..Default::default()
    };

    detail.parents = fields
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_string)
        .collect();

    detail.subject = fields.next().unwrap_or_default().to_string();
    detail.body = fields.next().unwrap_or_default().trim().to_string();

    detail
}

/// The commit this one should be compared against.
///
/// Always the first parent when there is one. That matters for merges: `git
/// show` renders no patch for a merge at all, so asking it for one file's diff
/// returns nothing and the pane looks broken while the file list beside it is
/// full. Diffing against the first parent gives the "what did merging this
/// bring in" view, and gives it for the file list and the patch alike.
///
/// A root commit has no parent; `show` handles that case on its own.
pub async fn first_parent(git: &Git, oid: &str) -> Result<Option<String>> {
    let parent = git
        .run_str_allowing(
            &["rev-parse", "--verify", "--quiet", &format!("{oid}^1")],
            &[1],
        )
        .await?;

    Ok((!parent.is_empty()).then_some(parent))
}

/// `-M` so a rename reads as one moved file rather than a delete and an add.
fn numstat_args(base: &Option<String>, oid: &str) -> Vec<String> {
    match base {
        Some(parent) => vec![
            "diff".into(),
            "--numstat".into(),
            "-z".into(),
            "-M".into(),
            parent.clone(),
            oid.to_string(),
        ],
        None => vec![
            "show".into(),
            "--numstat".into(),
            "-z".into(),
            "--format=".into(),
            "-M".into(),
            oid.to_string(),
        ],
    }
}

/// Parse `git show --numstat -z`.
///
/// Records are NUL-terminated `additions\tdeletions\tpath`. A rename is the
/// awkward one: the path field is left *empty* and the old and new paths follow
/// as two further NUL-terminated tokens, so the reader has to pull two extra
/// tokens whenever the path comes back blank.
pub fn parse_numstat(text: &str) -> Vec<FileStat> {
    let tokens: Vec<&str> = text.split('\0').collect();
    let mut files = Vec::new();
    let mut i = 0;

    while i < tokens.len() {
        let record = tokens[i];
        i += 1;

        if record.is_empty() {
            continue;
        }

        let mut parts = record.splitn(3, '\t');
        let (Some(added), Some(deleted)) = (parts.next(), parts.next()) else {
            continue;
        };
        let path = parts.next().unwrap_or("");

        // Git writes "-" for both counts when the file is binary; there are no
        // lines to count, and reporting zero would claim it did not change.
        let binary = added == "-" || deleted == "-";
        let additions = added.parse().unwrap_or(0);
        let deletions = deleted.parse().unwrap_or(0);

        if path.is_empty() {
            let old_path = tokens.get(i).copied().unwrap_or_default();
            let new_path = tokens.get(i + 1).copied().unwrap_or_default();
            i += 2;

            if new_path.is_empty() {
                continue;
            }

            files.push(FileStat {
                path: new_path.to_string(),
                old_path: Some(old_path.to_string()),
                additions,
                deletions,
                binary,
            });
        } else {
            files.push(FileStat {
                path: path.to_string(),
                old_path: None,
                additions,
                deletions,
                binary,
            });
        }
    }

    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ordinary_records() {
        let stats = parse_numstat("1\t1\tcomponents/Combobox.tsx\u{0}1400\t892\tyarn.lock\u{0}");

        assert_eq!(stats.len(), 2);
        assert_eq!(stats[0].path, "components/Combobox.tsx");
        assert_eq!(stats[0].additions, 1);
        assert_eq!(stats[0].deletions, 1);
        assert_eq!(stats[1].additions, 1400);
        assert_eq!(stats[1].deletions, 892);
    }

    #[test]
    fn a_rename_consumes_its_two_extra_tokens() {
        // The shape git actually emits: an empty path field, then old and new.
        let text = "0\t2\ta/DataForm.tsx\u{0}0\t0\t\u{0}a/Pdf.module.css\u{0}b/Pdf.module.css\u{0}268\t3\t\u{0}a/Pdf.tsx\u{0}b/Pdf.tsx\u{0}";
        let stats = parse_numstat(text);

        assert_eq!(stats.len(), 3);

        assert_eq!(stats[1].path, "b/Pdf.module.css");
        assert_eq!(stats[1].old_path.as_deref(), Some("a/Pdf.module.css"));

        // If the extra tokens were not consumed, this third entry would be lost
        // or shifted onto the wrong path.
        assert_eq!(stats[2].path, "b/Pdf.tsx");
        assert_eq!(stats[2].old_path.as_deref(), Some("a/Pdf.tsx"));
        assert_eq!(stats[2].additions, 268);
    }

    #[test]
    fn a_binary_file_is_marked_rather_than_counted_as_zero() {
        let stats = parse_numstat("-\t-\tlogo.png\u{0}");

        assert!(stats[0].binary);
        assert_eq!(stats[0].additions, 0);
        assert_eq!(stats[0].deletions, 0);
    }

    #[test]
    fn paths_with_spaces_survive() {
        let stats = parse_numstat("3\t4\tmy docs/a file.md\u{0}");
        assert_eq!(stats[0].path, "my docs/a file.md");
    }

    #[test]
    fn an_empty_diff_yields_no_files() {
        assert!(parse_numstat("").is_empty());
        assert!(parse_numstat("\u{0}").is_empty());
    }

    #[test]
    fn reads_the_metadata_fields() {
        let text = "abc123\u{1f}abc12\u{1f}Ada\u{1f}ada@example.com\u{1f}1700000000\u{1f}p1 p2\u{1f}Fix the thing\u{1f}A longer explanation.";
        let detail = parse_metadata(text);

        assert_eq!(detail.oid, "abc123");
        assert_eq!(detail.short, "abc12");
        assert_eq!(detail.author, "Ada");
        assert_eq!(detail.timestamp, 1_700_000_000);
        assert_eq!(detail.parents, vec!["p1", "p2"]);
        assert_eq!(detail.subject, "Fix the thing");
        assert_eq!(detail.body, "A longer explanation.");
    }

    #[test]
    fn a_commit_with_no_body_reports_an_empty_one() {
        let text = "abc\u{1f}abc\u{1f}Ada\u{1f}a@b.c\u{1f}1\u{1f}p\u{1f}Subject only\u{1f}";
        let detail = parse_metadata(text);

        assert_eq!(detail.subject, "Subject only");
        assert_eq!(detail.body, "");
    }

    #[test]
    fn a_root_commit_has_no_parents() {
        let text = "abc\u{1f}abc\u{1f}Ada\u{1f}a@b.c\u{1f}1\u{1f}\u{1f}init\u{1f}";
        assert!(parse_metadata(text).parents.is_empty());
    }
}
