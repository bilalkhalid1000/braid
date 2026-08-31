use serde::Serialize;

use super::cli::Git;
use crate::error::Result;

/// Above this, we stop building line objects and tell the UI the diff was cut.
/// A generated lockfile or a vendored bundle should never be able to freeze the
/// window, and nobody reads a 40MB diff line by line anyway.
const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Added,
    Removed,
    /// "\ No newline at end of file" and friends.
    Meta,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    pub content: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub binary: bool,
    pub truncated: bool,
    /// The lines git printed before the first hunk: `diff --git`, `index`,
    /// `---` and `+++`. Kept verbatim so a patch built from one hunk can carry
    /// the same header git would have written, rather than one reconstructed
    /// from a path and hoped to match.
    pub header: String,
    pub hunks: Vec<DiffHunk>,
    pub added: usize,
    pub removed: usize,
    pub duration_ms: u64,
}

/// Which side of the index a diff is being asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffTarget {
    /// Index against HEAD.
    Staged,
    /// Working tree against index.
    Worktree,
    /// A file git has never seen; shown as an all-added diff.
    Untracked,
}

/// How the user wants diffs rendered. Both are preferences, so they arrive
/// from the frontend rather than being decided here.
#[derive(Clone, Copy, Debug)]
pub struct DiffOptions {
    pub context_lines: u32,
    pub ignore_whitespace: bool,
}

impl Default for DiffOptions {
    fn default() -> Self {
        // Three is git's own default.
        Self {
            context_lines: 3,
            ignore_whitespace: false,
        }
    }
}

pub async fn file_diff(
    git: &Git,
    path: &str,
    target: DiffTarget,
    options: DiffOptions,
) -> Result<FileDiff> {
    let started = std::time::Instant::now();

    // `--no-ext-diff` matters: a user with a configured external difftool would
    // otherwise have it launched, or have its output substituted, on every
    // selection change.
    let unified = format!("--unified={}", options.context_lines);
    let mut base = vec!["diff", "--no-color", "--no-ext-diff", unified.as_str()];

    if options.ignore_whitespace {
        base.push("--ignore-all-space");
    }

    let text = match target {
        DiffTarget::Staged => {
            let args = [&base[..], &["--cached", "-M", "--", path]].concat();
            git.run_str(&args).await?
        }
        DiffTarget::Worktree => {
            let args = [&base[..], &["-M", "--", path]].concat();
            git.run_str(&args).await?
        }
        DiffTarget::Untracked => {
            // Diffing against /dev/null renders a new file as all additions.
            // `--no-index` reports "differences found" as exit code 1, which is
            // success for our purposes.
            let args = [&base[..], &["--no-index", "--", "/dev/null", path]].concat();
            git.run_str_allowing(&args, &[1]).await?
        }
    };

    let mut diff = parse(&text, path);
    diff.duration_ms = started.elapsed().as_millis() as u64;
    Ok(diff)
}

/// The diff a single commit made to one file.
///
/// On a merge this is the diff against the first parent, matching the file list
/// the detail pane shows.
pub async fn commit_file_diff(
    git: &Git,
    oid: &str,
    path: &str,
    options: DiffOptions,
) -> Result<FileDiff> {
    let started = std::time::Instant::now();

    let unified = format!("--unified={}", options.context_lines);

    // Against the first parent, matching the file list. `git show` renders no
    // patch at all for a merge, so using it here would leave the pane blank
    // beside a file list full of entries.
    let base = super::commit::first_parent(git, oid).await?;

    let mut args: Vec<String> = match &base {
        Some(parent) => vec!["diff".into(), parent.clone(), oid.to_string()],
        // A root commit has no parent to diff against; `show` handles it.
        None => vec!["show".into(), "--format=".into(), oid.to_string()],
    };

    for flag in ["--no-color", "--no-ext-diff", "-M", unified.as_str()] {
        args.insert(1, flag.to_string());
    }

    if options.ignore_whitespace {
        args.insert(1, "--ignore-all-space".into());
    }

    args.push("--".into());
    args.push(path.to_string());

    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    let text = git.run_str(&borrowed).await?;

    let mut diff = parse(&text, path);
    diff.duration_ms = started.elapsed().as_millis() as u64;
    Ok(diff)
}

pub fn parse(text: &str, path: &str) -> FileDiff {
    let mut diff = FileDiff {
        path: path.to_string(),
        truncated: text.len() > MAX_DIFF_BYTES,
        ..Default::default()
    };

    let body = if diff.truncated {
        // Cut on a line boundary so the last rendered line is not half a line.
        let cut = text[..MAX_DIFF_BYTES]
            .rfind('\n')
            .unwrap_or(MAX_DIFF_BYTES);
        &text[..cut]
    } else {
        text
    };

    let mut old_line = 0u32;
    let mut new_line = 0u32;
    let mut header = Vec::new();

    for line in body.lines() {
        if line.starts_with("@@") {
            let (old_start, new_start) = parse_hunk_header(line);
            old_line = old_start;
            new_line = new_start;

            diff.hunks.push(DiffHunk {
                header: line.to_string(),
                lines: Vec::new(),
            });
            continue;
        }

        // Everything before the first hunk is git's file header preamble.
        let Some(hunk) = diff.hunks.last_mut() else {
            if line.starts_with("Binary files") || line.starts_with("GIT binary patch") {
                diff.binary = true;
            }
            header.push(line.to_string());
            continue;
        };

        let (kind, content) = match line.as_bytes().first() {
            Some(b'+') => (LineKind::Added, &line[1..]),
            Some(b'-') => (LineKind::Removed, &line[1..]),
            Some(b' ') => (LineKind::Context, &line[1..]),
            Some(b'\\') => (LineKind::Meta, line),
            // A genuinely empty line inside a hunk is a context line whose
            // leading space git trimmed on the wire.
            None => (LineKind::Context, line),
            _ => continue,
        };

        let (old, new) = match kind {
            LineKind::Added => {
                diff.added += 1;
                new_line += 1;
                (None, Some(new_line))
            }
            LineKind::Removed => {
                diff.removed += 1;
                old_line += 1;
                (Some(old_line), None)
            }
            LineKind::Context => {
                old_line += 1;
                new_line += 1;
                (Some(old_line), Some(new_line))
            }
            LineKind::Meta => (None, None),
        };

        hunk.lines.push(DiffLine {
            kind,
            content: content.to_string(),
            old_line: old,
            new_line: new,
        });
    }

    diff.header = header.join("
");
    diff
}

/// Pull the starting line numbers out of `@@ -12,7 +14,9 @@ optional heading`.
/// The counts are ignored; we track position by walking the lines instead,
/// which stays correct even when git omits a count for a single-line side.
fn parse_hunk_header(header: &str) -> (u32, u32) {
    let mut old = 0;
    let mut new = 0;

    for token in header.split_whitespace() {
        let (target, rest) = match token.as_bytes().first() {
            Some(b'-') => (&mut old, &token[1..]),
            Some(b'+') => (&mut new, &token[1..]),
            _ => continue,
        };

        let start = rest.split(',').next().unwrap_or("0");
        if let Ok(value) = start.parse::<u32>() {
            // Hunks are 1-based; we pre-decrement so the first line increments
            // back to the real number.
            *target = value.saturating_sub(1);
        }
    }

    (old, new)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Written with `concat!` rather than backslash line-continuations: the
    // continuation escape strips leading whitespace, which would silently eat
    // the space that marks a context line.
    const SAMPLE: &str = concat!(
        "diff --git a/src/app.rs b/src/app.rs\n",
        "index 1111111..2222222 100644\n",
        "--- a/src/app.rs\n",
        "+++ b/src/app.rs\n",
        "@@ -10,3 +10,4 @@ fn main() {\n",
        " let a = 1;\n",
        "-let b = 2;\n",
        "+let b = 3;\n",
        "+let c = 4;\n",
    );

    #[test]
    fn counts_additions_and_removals() {
        let d = parse(SAMPLE, "src/app.rs");
        assert_eq!(d.added, 2);
        assert_eq!(d.removed, 1);
        assert!(!d.binary);
        assert!(!d.truncated);
    }

    #[test]
    fn assigns_line_numbers_per_side() {
        let d = parse(SAMPLE, "src/app.rs");
        let lines = &d.hunks[0].lines;

        // Context line keeps both sides in step.
        assert_eq!(lines[0].kind, LineKind::Context);
        assert_eq!(lines[0].old_line, Some(10));
        assert_eq!(lines[0].new_line, Some(10));

        // A removal advances only the old side.
        assert_eq!(lines[1].kind, LineKind::Removed);
        assert_eq!(lines[1].old_line, Some(11));
        assert_eq!(lines[1].new_line, None);

        // Additions advance only the new side.
        assert_eq!(lines[2].new_line, Some(11));
        assert_eq!(lines[3].new_line, Some(12));
        assert_eq!(lines[2].old_line, None);
    }

    #[test]
    fn strips_the_diff_marker_from_content() {
        let d = parse(SAMPLE, "src/app.rs");
        assert_eq!(d.hunks[0].lines[2].content, "let b = 3;");
    }

    #[test]
    fn header_preamble_never_becomes_a_hunk() {
        let d = parse(SAMPLE, "src/app.rs");
        assert_eq!(d.hunks.len(), 1);
        assert!(d.hunks[0].header.starts_with("@@ -10,3 +10,4 @@"));
    }

    #[test]
    fn detects_binary_files() {
        let text = concat!(
            "diff --git a/logo.png b/logo.png\n",
            "Binary files a/logo.png and b/logo.png differ\n",
        );
        let d = parse(text, "logo.png");

        assert!(d.binary);
        assert!(d.hunks.is_empty());
    }

    #[test]
    fn single_line_hunks_without_counts_parse() {
        let text = "@@ -5 +5 @@\n-old\n+new\n";
        let d = parse(text, "f.txt");

        assert_eq!(d.hunks[0].lines[0].old_line, Some(5));
        assert_eq!(d.hunks[0].lines[1].new_line, Some(5));
    }

    #[test]
    fn no_newline_marker_is_metadata_not_a_change() {
        let text = "@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n";
        let d = parse(text, "f.txt");

        let last = d.hunks[0].lines.last().unwrap();
        assert_eq!(last.kind, LineKind::Meta);
        assert_eq!(d.added, 1);
        assert_eq!(d.removed, 1);
    }
}
