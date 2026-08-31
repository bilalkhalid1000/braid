//! Diffs, and the partial staging built on top of them.
//!
//! The patch builder has unit tests over hand-written hunks; these check the
//! part those cannot — that the patch git is handed actually applies, and moves
//! exactly what was asked for.

mod common;

use braid_lib::git::patch::{self, Mode};
use braid_lib::git::diff::LineKind;
use braid_lib::git::{file_diff, status, DiffOptions, DiffTarget};
use common::TestRepo;

fn options() -> DiffOptions {
    DiffOptions::default()
}

#[tokio::test]
async fn a_worktree_diff_reports_the_change() {
    let repo = TestRepo::new();
    repo.write_numbered("file.txt", 10);
    repo.commit_all("Add a file");

    repo.write("file.txt", "line 1\nCHANGED\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n");

    let diff = file_diff(repo.git_api(), "file.txt", DiffTarget::Worktree, options())
        .await
        .unwrap();

    assert_eq!(diff.added, 1);
    assert_eq!(diff.removed, 1);
    assert_eq!(diff.hunks.len(), 1);
    assert!(!diff.header.is_empty(), "the patch header must be kept");
}

#[tokio::test]
async fn a_staged_diff_and_a_worktree_diff_show_different_things() {
    let repo = TestRepo::new();
    repo.write_numbered("file.txt", 5);
    repo.commit_all("Add a file");

    repo.write("file.txt", "line 1\nSTAGED\nline 3\nline 4\nline 5\n");
    repo.git(&["add", "file.txt"]);
    repo.write("file.txt", "line 1\nSTAGED\nline 3\nWORKTREE\nline 5\n");

    let staged = file_diff(repo.git_api(), "file.txt", DiffTarget::Staged, options())
        .await
        .unwrap();
    let worktree = file_diff(repo.git_api(), "file.txt", DiffTarget::Worktree, options())
        .await
        .unwrap();

    let changed = |diff: &braid_lib::git::FileDiff, text: &str| {
        diff.hunks
            .iter()
            .flat_map(|h| &h.lines)
            .any(|l| l.content == text && l.kind != LineKind::Context)
    };

    assert!(changed(&staged, "STAGED"));
    assert!(changed(&worktree, "WORKTREE"));

    // STAGED is identical on both sides of the index, so it does appear in the
    // worktree diff — as context. What matters is that it is not a change
    // there, or unstaging by hunk would move the wrong thing.
    assert!(!changed(&worktree, "STAGED"));
    assert!(worktree
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .any(|l| l.content == "STAGED" && l.kind == LineKind::Context));
}

#[tokio::test]
async fn an_untracked_file_reads_as_entirely_added() {
    let repo = TestRepo::new();
    repo.write("new.txt", "alpha\nbeta\n");

    let diff = file_diff(repo.git_api(), "new.txt", DiffTarget::Untracked, options())
        .await
        .unwrap();

    assert_eq!(diff.added, 2);
    assert_eq!(diff.removed, 0);
}

#[tokio::test]
async fn context_lines_change_how_many_hunks_there_are() {
    let repo = TestRepo::new();
    repo.write_numbered("file.txt", 30);
    repo.commit_all("Add a file");

    // Two edits far enough apart to be separate hunks at three lines of
    // context, and close enough to merge into one at fifteen.
    let mut lines: Vec<String> = (1..=30).map(|n| format!("line {n}")).collect();
    lines[4] = "FIRST".into();
    lines[24] = "SECOND".into();
    repo.write("file.txt", &format!("{}\n", lines.join("\n")));

    let tight = file_diff(
        repo.git_api(),
        "file.txt",
        DiffTarget::Worktree,
        DiffOptions { context_lines: 3, ignore_whitespace: false },
    )
    .await
    .unwrap();

    let wide = file_diff(
        repo.git_api(),
        "file.txt",
        DiffTarget::Worktree,
        DiffOptions { context_lines: 15, ignore_whitespace: false },
    )
    .await
    .unwrap();

    assert_eq!(tight.hunks.len(), 2);
    assert_eq!(wide.hunks.len(), 1);
}

#[tokio::test]
async fn ignoring_whitespace_hides_an_indentation_only_change() {
    let repo = TestRepo::new();
    repo.write("file.txt", "alpha\nbeta\n");
    repo.commit_all("Add a file");

    repo.write("file.txt", "    alpha\nbeta\n");

    let normal = file_diff(
        repo.git_api(),
        "file.txt",
        DiffTarget::Worktree,
        DiffOptions { context_lines: 3, ignore_whitespace: false },
    )
    .await
    .unwrap();

    let ignoring = file_diff(
        repo.git_api(),
        "file.txt",
        DiffTarget::Worktree,
        DiffOptions { context_lines: 3, ignore_whitespace: true },
    )
    .await
    .unwrap();

    assert_eq!(normal.added, 1);
    assert_eq!(ignoring.added, 0, "a whitespace-only change should vanish");
}

#[tokio::test]
async fn a_binary_file_is_flagged_rather_than_diffed() {
    let repo = TestRepo::new();
    std::fs::write(repo.path().join("logo.bin"), [0u8, 1, 2, 0, 255, 254]).unwrap();
    repo.commit_all("Add a binary file");

    std::fs::write(repo.path().join("logo.bin"), [0u8, 9, 9, 0, 1, 2]).unwrap();

    let diff = file_diff(repo.git_api(), "logo.bin", DiffTarget::Worktree, options())
        .await
        .unwrap();

    assert!(diff.binary);
    assert!(diff.hunks.is_empty());
}

// --- partial staging -------------------------------------------------------

#[tokio::test]
async fn staging_one_hunk_leaves_the_other_unstaged() {
    let repo = TestRepo::new();
    repo.write_numbered("file.txt", 30);
    repo.commit_all("Add a file");

    let mut lines: Vec<String> = (1..=30).map(|n| format!("line {n}")).collect();
    lines[4] = "FIRST".into();
    lines[24] = "SECOND".into();
    repo.write("file.txt", &format!("{}\n", lines.join("\n")));

    patch::apply(repo.git_api(), "file.txt", Mode::Stage, 0, None, 3)
        .await
        .unwrap();

    let staged = file_diff(repo.git_api(), "file.txt", DiffTarget::Staged, options())
        .await
        .unwrap();
    let worktree = file_diff(repo.git_api(), "file.txt", DiffTarget::Worktree, options())
        .await
        .unwrap();

    assert!(staged.hunks[0].lines.iter().any(|l| l.content == "FIRST"));
    assert!(!staged.hunks.iter().flat_map(|h| &h.lines).any(|l| l.content == "SECOND"));
    assert!(worktree.hunks[0].lines.iter().any(|l| l.content == "SECOND"));
}

#[tokio::test]
async fn staging_chosen_lines_stages_only_those() {
    let repo = TestRepo::new();
    repo.write("file.txt", "keep\n");
    repo.commit_all("Add a file");

    // Two additions in one hunk; only the first is wanted.
    repo.write("file.txt", "keep\nFIRST\nSECOND\n");

    let diff = file_diff(repo.git_api(), "file.txt", DiffTarget::Worktree, options())
        .await
        .unwrap();

    let first = diff.hunks[0]
        .lines
        .iter()
        .position(|l| l.content == "FIRST")
        .unwrap();

    patch::apply(repo.git_api(), "file.txt", Mode::Stage, 0, Some(&[first]), 3)
        .await
        .unwrap();

    let staged = file_diff(repo.git_api(), "file.txt", DiffTarget::Staged, options())
        .await
        .unwrap();

    let staged_lines: Vec<&str> = staged
        .hunks
        .iter()
        .flat_map(|h| &h.lines)
        .map(|l| l.content.as_str())
        .collect();

    assert!(staged_lines.contains(&"FIRST"));
    assert!(!staged_lines.contains(&"SECOND"));

    // And the worktree still has the line that was left behind.
    assert!(repo.read("file.txt").contains("SECOND"));
}

#[tokio::test]
async fn staging_an_addition_without_the_deletion_beside_it() {
    // The case the patch builder's counts are easiest to get wrong: the
    // unpicked deletion has to become context, or the patch will not apply.
    let repo = TestRepo::new();
    repo.write("file.txt", "one\nold\nthree\n");
    repo.commit_all("Add a file");

    repo.write("file.txt", "one\nnew\nthree\n");

    let diff = file_diff(repo.git_api(), "file.txt", DiffTarget::Worktree, options())
        .await
        .unwrap();

    let addition = diff.hunks[0]
        .lines
        .iter()
        .position(|l| l.content == "new")
        .unwrap();

    patch::apply(repo.git_api(), "file.txt", Mode::Stage, 0, Some(&[addition]), 3)
        .await
        .unwrap();

    // The index now holds both lines: "old" was never removed there.
    let staged_blob = repo.git(&["show", ":file.txt"]);
    assert!(staged_blob.contains("old"));
    assert!(staged_blob.contains("new"));
}

#[tokio::test]
async fn unstaging_a_hunk_puts_it_back_in_the_worktree() {
    let repo = TestRepo::new();
    repo.write_numbered("file.txt", 10);
    repo.commit_all("Add a file");

    repo.write("file.txt", "line 1\nCHANGED\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n");
    repo.git(&["add", "file.txt"]);

    let before = status(repo.git_api()).await.unwrap();
    assert_eq!(before.staged_count, 1);

    patch::apply(repo.git_api(), "file.txt", Mode::Unstage, 0, None, 3)
        .await
        .unwrap();

    let after = status(repo.git_api()).await.unwrap();
    assert_eq!(after.staged_count, 0);
    assert_eq!(after.unstaged_count, 1);

    // Unstaging must not touch the file itself.
    assert!(repo.read("file.txt").contains("CHANGED"));
}

#[tokio::test]
async fn discarding_a_hunk_reverts_the_file() {
    let repo = TestRepo::new();
    repo.write_numbered("file.txt", 10);
    repo.commit_all("Add a file");

    repo.write("file.txt", "line 1\nCHANGED\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n");

    patch::apply(repo.git_api(), "file.txt", Mode::Discard, 0, None, 3)
        .await
        .unwrap();

    assert!(!repo.read("file.txt").contains("CHANGED"));
    assert_eq!(status(repo.git_api()).await.unwrap().unstaged_count, 0);
}

#[tokio::test]
async fn a_hunk_index_that_no_longer_exists_is_refused() {
    let repo = TestRepo::new();
    repo.write("file.txt", "one\n");
    repo.commit_all("Add a file");
    repo.write("file.txt", "two\n");

    let result = patch::apply(repo.git_api(), "file.txt", Mode::Stage, 99, None, 3).await;

    assert!(result.is_err(), "an out-of-range hunk must not silently do nothing");
}

#[tokio::test]
async fn a_selection_containing_no_change_is_refused() {
    let repo = TestRepo::new();
    repo.write_numbered("file.txt", 10);
    repo.commit_all("Add a file");

    repo.write("file.txt", "line 1\nCHANGED\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n");

    let diff = file_diff(repo.git_api(), "file.txt", DiffTarget::Worktree, options())
        .await
        .unwrap();

    let context = diff.hunks[0]
        .lines
        .iter()
        .position(|l| l.content == "line 1")
        .unwrap();

    // Selecting only a context line would produce a patch that applies and
    // changes nothing, which would look like a silent failure.
    let result = patch::apply(repo.git_api(), "file.txt", Mode::Stage, 0, Some(&[context]), 3).await;

    assert!(result.is_err());
}

#[tokio::test]
async fn zero_context_patches_still_apply() {
    let repo = TestRepo::new();
    repo.write_numbered("file.txt", 10);
    repo.commit_all("Add a file");

    repo.write("file.txt", "line 1\nCHANGED\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\n");

    // Git rejects a zero-context patch as malformed unless told otherwise.
    patch::apply(repo.git_api(), "file.txt", Mode::Stage, 0, None, 0)
        .await
        .unwrap();

    assert_eq!(status(repo.git_api()).await.unwrap().staged_count, 1);
}
