//! Working-copy status, against a real repository.

mod common;

use braid_lib::git::status::EntryKind;
use braid_lib::git::{status, RepoState};
use common::TestRepo;

#[tokio::test]
async fn a_fresh_repository_is_clean() {
    let repo = TestRepo::new();
    let result = status(repo.git_api()).await.unwrap();

    assert_eq!(result.head.as_deref(), Some("main"));
    assert!(result.entries.is_empty());
    assert_eq!(result.staged_count, 0);
    assert_eq!(result.unstaged_count, 0);
    assert_eq!(result.state, RepoState::Clean);
}

#[tokio::test]
async fn an_untracked_file_is_reported_as_untracked() {
    let repo = TestRepo::new();
    repo.write("new.txt", "content\n");

    let result = status(repo.git_api()).await.unwrap();
    let entry = result.entries.iter().find(|e| e.path == "new.txt").unwrap();

    assert_eq!(entry.kind, EntryKind::Untracked);
    assert_eq!(result.untracked_count, 1);
    assert_eq!(result.staged_count, 0);
}

#[tokio::test]
async fn a_modified_file_counts_as_unstaged_until_it_is_added() {
    let repo = TestRepo::new();
    repo.write("README.md", "changed\n");

    let before = status(repo.git_api()).await.unwrap();
    assert_eq!(before.unstaged_count, 1);
    assert_eq!(before.staged_count, 0);

    repo.git(&["add", "README.md"]);

    let after = status(repo.git_api()).await.unwrap();
    assert_eq!(after.staged_count, 1);
    assert_eq!(after.unstaged_count, 0);
}

#[tokio::test]
async fn a_file_can_be_staged_and_modified_at_once() {
    let repo = TestRepo::new();

    repo.write("README.md", "staged version\n");
    repo.git(&["add", "README.md"]);
    repo.write("README.md", "and then changed again\n");

    let result = status(repo.git_api()).await.unwrap();
    let entry = result.entries.iter().find(|e| e.path == "README.md").unwrap();

    // Both sides of the index differ, so it appears in both lists.
    assert_eq!(entry.index_status, "M");
    assert_eq!(entry.worktree_status, "M");
    assert_eq!(result.staged_count, 1);
    assert_eq!(result.unstaged_count, 1);
}

#[tokio::test]
async fn a_deleted_file_is_reported() {
    let repo = TestRepo::new();
    repo.remove("README.md");

    let result = status(repo.git_api()).await.unwrap();
    let entry = result.entries.iter().find(|e| e.path == "README.md").unwrap();

    assert_eq!(entry.worktree_status, "D");
}

#[tokio::test]
async fn a_rename_carries_its_original_path() {
    let repo = TestRepo::new();

    repo.write("original.txt", "some content worth detecting\n");
    repo.commit_all("Add a file");

    repo.git(&["mv", "original.txt", "renamed.txt"]);

    let result = status(repo.git_api()).await.unwrap();
    let entry = result.entries.iter().find(|e| e.path == "renamed.txt").unwrap();

    assert_eq!(entry.kind, EntryKind::Renamed);
    assert_eq!(entry.orig_path.as_deref(), Some("original.txt"));
}

#[tokio::test]
async fn a_path_containing_spaces_survives_the_parser() {
    let repo = TestRepo::new();
    repo.write("my docs/a file.md", "text\n");

    let result = status(repo.git_api()).await.unwrap();

    assert!(result.entries.iter().any(|e| e.path == "my docs/a file.md"));
}

#[tokio::test]
async fn tracking_information_reports_ahead_and_behind() {
    let repo = TestRepo::new();

    // A second repository standing in for a remote.
    let remote = TestRepo::empty();
    repo.git(&["remote", "add", "origin", &remote.path().to_string_lossy()]);
    remote.git(&["config", "receive.denyCurrentBranch", "ignore"]);

    repo.git(&["push", "-u", "origin", "main"]);

    let synced = status(repo.git_api()).await.unwrap();
    assert_eq!(synced.upstream.as_deref(), Some("origin/main"));
    assert_eq!(synced.ahead, 0);
    assert_eq!(synced.behind, 0);

    repo.write("second.txt", "more\n");
    repo.commit_all("A second commit");

    let ahead = status(repo.git_api()).await.unwrap();
    assert_eq!(ahead.ahead, 1);
    assert_eq!(ahead.behind, 0);
}

#[tokio::test]
async fn a_detached_head_has_no_branch_name() {
    let repo = TestRepo::new();
    repo.write("second.txt", "more\n");
    repo.commit_all("Second");

    repo.git(&["checkout", "--detach", "HEAD~1"]);

    let result = status(repo.git_api()).await.unwrap();
    assert!(result.head.is_none());
    assert!(result.head_oid.is_some());
}

#[tokio::test]
async fn a_repository_with_no_commits_reports_no_head_oid() {
    let repo = TestRepo::empty();
    repo.write("first.txt", "content\n");

    let result = status(repo.git_api()).await.unwrap();

    // `main` exists as a name before it has any commit on it.
    assert_eq!(result.head.as_deref(), Some("main"));
    assert!(result.head_oid.is_none());
    assert_eq!(result.untracked_count, 1);
}

#[tokio::test]
async fn ignored_files_are_not_reported_as_untracked() {
    let repo = TestRepo::new();
    repo.write(".gitignore", "ignored/\n");
    repo.commit_all("Add ignore rules");

    repo.write("ignored/thing.txt", "junk\n");

    let result = status(repo.git_api()).await.unwrap();

    assert_eq!(result.untracked_count, 0);
    assert!(!result.entries.iter().any(|e| e.path.starts_with("ignored/")));
}
