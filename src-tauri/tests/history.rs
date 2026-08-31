//! History, refs and commit detail, against a real repository.

mod common;

use braid_lib::git::{commit, log, refs};
use common::TestRepo;

#[tokio::test]
async fn a_log_page_reports_commits_newest_first() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("Second");
    repo.write("b.txt", "b\n");
    repo.commit_all("Third");

    let page = log(repo.git_api(), 0, 10).await.unwrap();

    assert_eq!(page.commits.len(), 3);
    assert_eq!(page.commits[0].subject, "Third");
    assert_eq!(page.commits[2].subject, "Initial commit");
    assert!(!page.has_more);
}

#[tokio::test]
async fn paging_skips_and_reports_whether_more_remain() {
    let repo = TestRepo::new();
    for n in 1..=5 {
        repo.write(&format!("f{n}.txt"), "x\n");
        repo.commit_all(&format!("Commit {n}"));
    }

    let first = log(repo.git_api(), 0, 2).await.unwrap();
    assert_eq!(first.commits.len(), 2);
    assert!(first.has_more, "a full page means there may be more");

    let second = log(repo.git_api(), 2, 2).await.unwrap();
    assert_eq!(second.commits[0].subject, "Commit 3");

    // The pages must not overlap.
    assert_ne!(first.commits[0].oid, second.commits[0].oid);
}

#[tokio::test]
async fn an_empty_repository_produces_no_commits_rather_than_an_error() {
    let repo = TestRepo::empty();

    // `git log` exits 128 with no HEAD; an empty history is a real state.
    let page = log(repo.git_api(), 0, 10).await.unwrap();
    assert!(page.commits.is_empty());
}

#[tokio::test]
async fn a_merge_commit_reports_both_parents() {
    let repo = TestRepo::new();

    repo.git(&["checkout", "-b", "feature"]);
    repo.write("feature.txt", "work\n");
    repo.commit_all("Feature work");

    repo.git(&["checkout", "main"]);
    repo.write("main.txt", "other\n");
    repo.commit_all("Main work");

    repo.git(&["merge", "--no-ff", "--no-edit", "feature"]);

    let page = log(repo.git_api(), 0, 10).await.unwrap();
    let merge = &page.commits[0];

    assert_eq!(merge.parents.len(), 2);
}

#[tokio::test]
async fn decorations_are_reported_for_the_checked_out_branch() {
    let repo = TestRepo::new();
    repo.git(&["tag", "v1.0"]);

    let page = log(repo.git_api(), 0, 10).await.unwrap();
    let refs_on_head = &page.commits[0].refs;

    assert!(refs_on_head.iter().any(|r| r.contains("HEAD")));
    assert!(refs_on_head.iter().any(|r| r.contains("v1.0")));
}

#[tokio::test]
async fn a_subject_containing_unusual_characters_survives() {
    let repo = TestRepo::new();
    repo.write("x.txt", "x\n");
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-m", "feat: add | pipes, \"quotes\" and 'apostrophes'"]);

    let page = log(repo.git_api(), 0, 1).await.unwrap();
    assert_eq!(
        page.commits[0].subject,
        "feat: add | pipes, \"quotes\" and 'apostrophes'"
    );
}

// --- refs ------------------------------------------------------------------

#[tokio::test]
async fn branches_are_listed_with_the_current_one_marked() {
    let repo = TestRepo::new();
    repo.git(&["branch", "feature"]);

    let snapshot = refs(repo.git_api()).await.unwrap();

    assert_eq!(snapshot.branches.len(), 2);
    let head = snapshot.branches.iter().find(|b| b.is_head).unwrap();
    assert_eq!(head.name, "main");
}

#[tokio::test]
async fn tags_and_stashes_are_listed() {
    let repo = TestRepo::new();
    repo.git(&["tag", "v1.0"]);

    repo.write("README.md", "work in progress\n");
    repo.git(&["stash", "push", "-m", "my stash"]);

    let snapshot = refs(repo.git_api()).await.unwrap();

    assert!(snapshot.tags.contains(&"v1.0".to_string()));
    assert_eq!(snapshot.stashes.len(), 1);
    assert_eq!(snapshot.stashes[0].selector, "stash@{0}");
    assert!(snapshot.stashes[0].message.contains("my stash"));
}

#[tokio::test]
async fn remote_branches_are_grouped_by_remote() {
    let repo = TestRepo::new();
    let remote = TestRepo::empty();
    remote.git(&["config", "receive.denyCurrentBranch", "ignore"]);

    repo.git(&["remote", "add", "origin", &remote.path().to_string_lossy()]);
    repo.git(&["push", "-u", "origin", "main"]);

    let snapshot = refs(repo.git_api()).await.unwrap();
    let origin = snapshot.remotes.iter().find(|r| r.name == "origin").unwrap();

    assert!(origin.branches.contains(&"main".to_string()));
}

#[tokio::test]
async fn a_branch_name_containing_slashes_stays_whole() {
    let repo = TestRepo::new();
    repo.git(&["branch", "feature/deep/name"]);

    let snapshot = refs(repo.git_api()).await.unwrap();

    assert!(snapshot
        .branches
        .iter()
        .any(|b| b.name == "feature/deep/name"));
}

// --- commit detail ---------------------------------------------------------

#[tokio::test]
async fn commit_detail_reports_metadata_and_files() {
    let repo = TestRepo::new();
    repo.write("one.txt", "alpha\nbeta\n");
    repo.write("two.txt", "gamma\n");
    repo.git(&["add", "-A"]);
    repo.git(&["commit", "-m", "Add two files\n\nWith a longer explanation."]);

    let detail = commit::detail(repo.git_api(), &repo.head()).await.unwrap();

    assert_eq!(detail.subject, "Add two files");
    assert_eq!(detail.body, "With a longer explanation.");
    assert_eq!(detail.author, "Test");
    assert_eq!(detail.files.len(), 2);
    assert_eq!(detail.additions, 3);
    assert_eq!(detail.deletions, 0);
}

#[tokio::test]
async fn commit_detail_reports_a_rename_with_its_old_path() {
    let repo = TestRepo::new();
    repo.write("original.txt", "content worth detecting as a rename\n");
    repo.commit_all("Add a file");

    repo.git(&["mv", "original.txt", "renamed.txt"]);
    repo.commit_all("Rename it");

    let detail = commit::detail(repo.git_api(), &repo.head()).await.unwrap();
    let file = &detail.files[0];

    assert_eq!(file.path, "renamed.txt");
    assert_eq!(file.old_path.as_deref(), Some("original.txt"));
}

#[tokio::test]
async fn commit_detail_marks_a_binary_file() {
    let repo = TestRepo::new();
    std::fs::write(repo.path().join("logo.bin"), [0u8, 1, 2, 0, 255]).unwrap();
    repo.commit_all("Add a binary file");

    let detail = commit::detail(repo.git_api(), &repo.head()).await.unwrap();
    let file = detail.files.iter().find(|f| f.path == "logo.bin").unwrap();

    assert!(file.binary);
    assert_eq!(file.additions, 0);
}

#[tokio::test]
async fn a_merge_reports_the_files_it_brought_in() {
    // The case that was broken: `git show` renders no patch for a merge, so
    // the detail pane has to diff against the first parent instead.
    let repo = TestRepo::new();

    repo.git(&["checkout", "-b", "feature"]);
    repo.write("brought-in.txt", "from the branch\n");
    repo.commit_all("Feature work");

    repo.git(&["checkout", "main"]);
    repo.write("on-main.txt", "unrelated\n");
    repo.commit_all("Main work");

    repo.git(&["merge", "--no-ff", "--no-edit", "feature"]);

    let detail = commit::detail(repo.git_api(), &repo.head()).await.unwrap();

    assert_eq!(detail.parents.len(), 2);
    assert!(
        detail.files.iter().any(|f| f.path == "brought-in.txt"),
        "a merge should list what it merged in, not nothing",
    );
}

#[tokio::test]
async fn a_files_diff_within_a_merge_is_not_empty() {
    let repo = TestRepo::new();

    repo.git(&["checkout", "-b", "feature"]);
    repo.write("brought-in.txt", "from the branch\n");
    repo.commit_all("Feature work");

    repo.git(&["checkout", "main"]);
    repo.write("on-main.txt", "unrelated\n");
    repo.commit_all("Main work");

    repo.git(&["merge", "--no-ff", "--no-edit", "feature"]);

    let diff = braid_lib::git::diff::commit_file_diff(
        repo.git_api(),
        &repo.head(),
        "brought-in.txt",
        Default::default(),
    )
    .await
    .unwrap();

    assert!(
        diff.added > 0,
        "the pane showed a file list beside an empty diff before this",
    );
}

#[tokio::test]
async fn a_root_commit_has_a_diff_despite_having_no_parent() {
    let repo = TestRepo::new();
    let root = repo.git(&["rev-list", "--max-parents=0", "HEAD"]).trim().to_string();

    let detail = commit::detail(repo.git_api(), &root).await.unwrap();
    assert!(detail.parents.is_empty());
    assert_eq!(detail.files.len(), 1);

    let diff = braid_lib::git::diff::commit_file_diff(
        repo.git_api(),
        &root,
        "README.md",
        Default::default(),
    )
    .await
    .unwrap();

    assert!(diff.added > 0);
}
