//! Building a patch for part of a diff, so a hunk or a few lines can be staged
//! on their own.
//!
//! This is how partial staging works everywhere: take the diff git already
//! produced, keep the piece the user picked, recompute the hunk header so the
//! line counts match what is left, and hand the result to `git apply`.
//!
//! The subtle part is what happens to the lines the user did *not* pick, and it
//! depends on which direction the patch will be applied:
//!
//! - Staging (a forward apply): an unpicked `+` line is not in the target yet,
//!   so it is dropped. An unpicked `-` line is still there and must stay, so it
//!   becomes context.
//! - Unstaging (a reverse apply): git flips the patch before applying it, so
//!   the two cases swap. An unpicked `+` becomes context and an unpicked `-` is
//!   dropped.
//!
//! Get that backwards and the patch either fails to apply or silently stages
//! the opposite of what was asked for.

use super::cli::Git;
use super::diff::{self, DiffHunk, DiffOptions, DiffTarget, FileDiff, LineKind};
use crate::error::{AppError, Result};

/// What a hunk action does to the index or the worktree.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Stage,
    Unstage,
    Discard,
}

impl Mode {
    pub fn parse(name: &str) -> Result<Self> {
        match name {
            "stage" => Ok(Mode::Stage),
            "unstage" => Ok(Mode::Unstage),
            "discard" => Ok(Mode::Discard),
            other => Err(AppError::App(format!("unknown hunk action: {other}"))),
        }
    }

    /// Which diff the hunk index refers to.
    fn target(&self) -> DiffTarget {
        match self {
            Mode::Unstage => DiffTarget::Staged,
            _ => DiffTarget::Worktree,
        }
    }

    /// How the patch will be handed to `git apply`, which decides what happens
    /// to the lines the user did not pick.
    fn direction(&self) -> Direction {
        match self {
            Mode::Stage => Direction::Forward,
            _ => Direction::Reverse,
        }
    }

    fn apply_args(&self) -> &'static [&'static str] {
        match self {
            Mode::Stage => &["apply", "--cached"],
            Mode::Unstage => &["apply", "--cached", "--reverse"],
            Mode::Discard => &["apply", "--reverse"],
        }
    }
}

/// Stage, unstage or discard one hunk — or a chosen few of its lines.
///
/// The diff is read again here rather than trusted from the caller, so the
/// patch is built from what git says right now. The caller passes the context
/// setting the UI rendered with, because a hunk index only means anything
/// against a diff cut the same way.
pub async fn apply(
    git: &Git,
    path: &str,
    mode: Mode,
    hunk_index: usize,
    lines: Option<&[usize]>,
    context_lines: u32,
) -> Result<String> {
    let diff = diff::file_diff(
        git,
        path,
        mode.target(),
        DiffOptions {
            context_lines,
            // A diff that ignores whitespace has had real changes removed from
            // it, so a patch built from one does not describe the file.
            ignore_whitespace: false,
        },
    )
    .await?;

    let hunk = diff
        .hunks
        .get(hunk_index)
        .ok_or_else(|| AppError::App("That hunk is no longer there; the file changed.".into()))?;

    let patch = build(&diff, hunk, lines, mode.direction())
        .ok_or_else(|| AppError::App("Nothing in that selection would change the file.".into()))?;

    let mut args = mode.apply_args().to_vec();

    // With no context lines git needs telling that a zero-context patch is
    // intentional rather than malformed.
    if context_lines == 0 {
        args.push("--unidiff-zero");
    }

    args.push("-");
    git.run_with_stdin(&args, &patch).await
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    /// The patch will be applied as-is.
    Forward,
    /// The patch will be applied with `--reverse`.
    Reverse,
}

/// Build a patch containing one hunk, optionally narrowed to some of its lines.
///
/// `selected` holds indices into the hunk's line list. `None` means the whole
/// hunk. Returns `None` when the selection leaves nothing to apply.
pub fn build(
    diff: &FileDiff,
    hunk: &DiffHunk,
    selected: Option<&[usize]>,
    direction: Direction,
) -> Option<String> {
    let keeps = |index: usize| selected.is_none_or(|list| list.contains(&index));

    let mut body = Vec::new();
    let mut old_count = 0u32;
    let mut new_count = 0u32;
    let mut changed = false;

    for (index, line) in hunk.lines.iter().enumerate() {
        // "\ No newline at end of file" belongs to whichever line precedes it
        // and carries no counts of its own.
        if line.kind == LineKind::Meta {
            if body.last().is_some_and(|last: &String| !last.starts_with(' ')) {
                body.push(line.content.clone());
            }
            continue;
        }

        let picked = keeps(index);

        let marker = match (line.kind, picked, direction) {
            (LineKind::Context, _, _) => ' ',

            (LineKind::Added, true, _) | (LineKind::Removed, true, _) => {
                changed = true;
                if line.kind == LineKind::Added {
                    '+'
                } else {
                    '-'
                }
            }

            // Unpicked, so it has to end up as whatever leaves the file alone
            // once this patch is applied in this direction.
            (LineKind::Added, false, Direction::Forward) => continue,
            (LineKind::Added, false, Direction::Reverse) => ' ',
            (LineKind::Removed, false, Direction::Forward) => ' ',
            (LineKind::Removed, false, Direction::Reverse) => continue,

            (LineKind::Meta, _, _) => unreachable!("handled above"),
        };

        match marker {
            ' ' => {
                old_count += 1;
                new_count += 1;
            }
            '+' => new_count += 1,
            _ => old_count += 1,
        }

        body.push(format!("{marker}{}", line.content));
    }

    // A patch with no additions or deletions left would apply cleanly and do
    // nothing, which is worse than refusing: the UI would report success.
    if !changed {
        return None;
    }

    let (old_start, new_start) = starts(&hunk.header);

    let mut patch = String::new();
    if !diff.header.is_empty() {
        patch.push_str(&diff.header);
        patch.push('\n');
    }

    patch.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        // Git writes a start of 0 only for an empty side; a non-empty side
        // always starts at 1 or more.
        if old_count == 0 { 0 } else { old_start.max(1) },
        old_count,
        if new_count == 0 { 0 } else { new_start.max(1) },
        new_count,
    ));

    for line in body {
        patch.push_str(&line);
        patch.push('\n');
    }

    Some(patch)
}

/// Pull the two starting line numbers out of `@@ -12,7 +14,9 @@`.
fn starts(header: &str) -> (u32, u32) {
    let mut old = 1;
    let mut new = 1;

    for token in header.split_whitespace() {
        let (target, rest) = match token.as_bytes().first() {
            Some(b'-') => (&mut old, &token[1..]),
            Some(b'+') => (&mut new, &token[1..]),
            _ => continue,
        };

        if let Ok(value) = rest.split(',').next().unwrap_or("0").parse::<u32>() {
            *target = value;
        }
    }

    (old, new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::diff::{DiffLine, DiffHunk, FileDiff, LineKind};

    fn line(kind: LineKind, content: &str) -> DiffLine {
        DiffLine {
            kind,
            content: content.to_string(),
            old_line: None,
            new_line: None,
        }
    }

    /// A hunk with one context line, one deletion and two additions.
    fn sample() -> (FileDiff, DiffHunk) {
        let hunk = DiffHunk {
            header: "@@ -10,2 +10,3 @@".to_string(),
            lines: vec![
                line(LineKind::Context, "let a = 1;"),
                line(LineKind::Removed, "let b = 2;"),
                line(LineKind::Added, "let b = 3;"),
                line(LineKind::Added, "let c = 4;"),
            ],
        };

        let diff = FileDiff {
            path: "src/app.rs".into(),
            header: "diff --git a/src/app.rs b/src/app.rs\n--- a/src/app.rs\n+++ b/src/app.rs"
                .into(),
            ..Default::default()
        };

        (diff, hunk)
    }

    #[test]
    fn a_whole_hunk_keeps_every_line_and_counts_both_sides() {
        let (diff, hunk) = sample();
        let patch = build(&diff, &hunk, None, Direction::Forward).unwrap();

        // One context + one removed on the old side; one context + two added
        // on the new side.
        assert!(patch.contains("@@ -10,2 +10,3 @@"));
        assert!(patch.contains("\n-let b = 2;\n"));
        assert!(patch.contains("\n+let b = 3;\n"));
        assert!(patch.contains("\n+let c = 4;\n"));
    }

    #[test]
    fn the_file_header_is_carried_through_verbatim() {
        let (diff, hunk) = sample();
        let patch = build(&diff, &hunk, None, Direction::Forward).unwrap();

        assert!(patch.starts_with("diff --git a/src/app.rs b/src/app.rs\n"));
        assert!(patch.contains("--- a/src/app.rs\n+++ b/src/app.rs\n"));
    }

    #[test]
    fn staging_one_addition_drops_the_other() {
        let (diff, hunk) = sample();
        // Keep the context and only the first addition.
        let patch = build(&diff, &hunk, Some(&[0, 2]), Direction::Forward).unwrap();

        assert!(patch.contains("+let b = 3;"));
        assert!(!patch.contains("let c = 4;"));

        // The unpicked deletion stays in the file, so it becomes context — and
        // context counts on *both* sides. Old: the two surviving lines. New:
        // those two plus the one addition being staged.
        assert!(patch.contains(" let b = 2;"));
        assert!(patch.contains("@@ -10,2 +10,3 @@"));
    }

    #[test]
    fn staging_without_the_deletion_turns_it_into_context() {
        let (diff, hunk) = sample();
        // Both additions, but not the deletion.
        let patch = build(&diff, &hunk, Some(&[0, 2, 3]), Direction::Forward).unwrap();

        // The line is still in the file, so it has to appear as context or the
        // patch will not apply.
        assert!(patch.contains(" let b = 2;"));
        assert!(!patch.contains("-let b = 2;"));
        assert!(patch.contains("@@ -10,2 +10,4 @@"));
    }

    #[test]
    fn reversing_mirrors_how_unpicked_lines_are_treated() {
        let (diff, hunk) = sample();
        // Unstage only the deletion. On a reverse apply the unpicked additions
        // must become context, not be dropped.
        let patch = build(&diff, &hunk, Some(&[0, 1]), Direction::Reverse).unwrap();

        assert!(patch.contains("-let b = 2;"));
        assert!(patch.contains(" let b = 3;"));
        assert!(patch.contains(" let c = 4;"));
        assert!(!patch.contains("+let b = 3;"));
    }

    #[test]
    fn a_selection_with_no_change_in_it_builds_nothing() {
        let (diff, hunk) = sample();
        // Context only: applying this would succeed and change nothing, which
        // would look like a staging that silently did not happen.
        assert!(build(&diff, &hunk, Some(&[0]), Direction::Forward).is_none());
    }

    #[test]
    fn an_empty_selection_builds_nothing() {
        let (diff, hunk) = sample();
        assert!(build(&diff, &hunk, Some(&[]), Direction::Forward).is_none());
    }

    #[test]
    fn a_pure_addition_reports_a_zero_length_old_side() {
        let hunk = DiffHunk {
            header: "@@ -0,0 +1,2 @@".into(),
            lines: vec![
                line(LineKind::Added, "first"),
                line(LineKind::Added, "second"),
            ],
        };
        let diff = FileDiff {
            path: "new.txt".into(),
            header: "--- /dev/null\n+++ b/new.txt".into(),
            ..Default::default()
        };

        let patch = build(&diff, &hunk, None, Direction::Forward).unwrap();
        assert!(patch.contains("@@ -0,0 +1,2 @@"));
    }

    #[test]
    fn the_no_newline_marker_follows_the_line_it_belongs_to() {
        let hunk = DiffHunk {
            header: "@@ -1 +1 @@".into(),
            lines: vec![
                line(LineKind::Removed, "old"),
                line(LineKind::Added, "new"),
                line(LineKind::Meta, "\\ No newline at end of file"),
            ],
        };
        let diff = FileDiff {
            path: "f.txt".into(),
            header: "--- a/f.txt\n+++ b/f.txt".into(),
            ..Default::default()
        };

        let patch = build(&diff, &hunk, None, Direction::Forward).unwrap();
        assert!(patch.contains("\\ No newline at end of file"));

        // It carries no counts of its own.
        assert!(patch.contains("@@ -1,1 +1,1 @@"));
    }

    #[test]
    fn every_patch_ends_with_a_newline() {
        // `git apply` rejects a patch whose last line is unterminated.
        let (diff, hunk) = sample();
        let patch = build(&diff, &hunk, None, Direction::Forward).unwrap();

        assert!(patch.ends_with('\n'));
    }
}
