//! Reset and revert, against a real repository.
//!
//! Reset is the one everyday git command that can destroy work with no record
//! of it, so the modes are checked for what they leave behind rather than only
//! for where the branch ends up -- the difference between them is the whole
//! reason the menu offers three.

mod common;

use braid_lib::git::{impact, reset, revert, ResetMode};
use common::TestRepo;

/// main with three commits, the newest touching `work.txt`.
fn three() -> TestRepo {
    let repo = TestRepo::new();

    repo.write("work.txt", "one\n");
    repo.commit_all("Second");
    repo.write("work.txt", "one\ntwo\n");
    repo.commit_all("Third");

    repo
}

fn subjects(repo: &TestRepo) -> String {
    repo.git(&["log", "--format=%s"])
}

#[tokio::test]
async fn a_soft_reset_moves_the_branch_and_keeps_the_changes_staged() {
    let repo = three();

    reset(repo.git_api(), "HEAD~1", ResetMode::Soft).await.unwrap();

    assert!(!subjects(&repo).contains("Third"), "the branch should have moved");
    // The file still holds what the dropped commit put there, and it is staged
    // -- which is what makes soft the mode for redoing a commit message.
    assert_eq!(repo.read("work.txt"), "one\ntwo\n");
    assert!(repo.git(&["diff", "--cached", "--name-only"]).contains("work.txt"));
}

#[tokio::test]
async fn a_mixed_reset_keeps_the_changes_but_unstages_them() {
    let repo = three();

    reset(repo.git_api(), "HEAD~1", ResetMode::Mixed).await.unwrap();

    assert_eq!(repo.read("work.txt"), "one\ntwo\n");
    assert!(
        repo.git(&["diff", "--cached", "--name-only"]).trim().is_empty(),
        "mixed is the mode that leaves nothing staged"
    );
    assert!(repo.git(&["diff", "--name-only"]).contains("work.txt"));
}

#[tokio::test]
async fn a_hard_reset_takes_the_changes_with_it() {
    let repo = three();

    reset(repo.git_api(), "HEAD~1", ResetMode::Hard).await.unwrap();

    assert_eq!(repo.read("work.txt"), "one\n", "the newer content is gone");
    assert!(repo.git(&["status", "--porcelain"]).trim().is_empty());
}

#[tokio::test]
async fn a_hard_reset_leaves_untracked_files_alone() {
    // Worth pinning because the confirmation says "anything not committed
    // elsewhere cannot be recovered", and a file git never knew about is not
    // covered by that sentence -- it survives.
    let repo = three();
    repo.write("scratch.txt", "not git's business\n");

    reset(repo.git_api(), "HEAD~1", ResetMode::Hard).await.unwrap();

    assert!(repo.exists("scratch.txt"));
}

#[tokio::test]
async fn resetting_to_where_the_branch_already_is_drops_nothing() {
    let repo = three();

    let found = impact(repo.git_api(), "HEAD").await.unwrap();

    assert_eq!(found.dropped, 0);
}

#[tokio::test]
async fn the_impact_counts_the_commits_the_branch_would_stop_pointing_at() {
    let repo = three();

    assert_eq!(impact(repo.git_api(), "HEAD~1").await.unwrap().dropped, 1);
    assert_eq!(impact(repo.git_api(), "HEAD~2").await.unwrap().dropped, 2);
}

#[tokio::test]
async fn a_branch_with_no_upstream_has_nothing_published() {
    let repo = three();

    let found = impact(repo.git_api(), "HEAD~2").await.unwrap();

    assert_eq!(found.upstream, None);
    assert_eq!(found.published, 0, "nothing can be published with nowhere to publish to");
}

/// Give `main` a tracking branch at its current tip, the way a pushed branch
/// looks without needing a second repository on disk.
fn with_upstream(repo: &TestRepo) {
    let tip = repo.head();

    // The url matters: @{upstream} resolves through the remote, so the branch
    // keys alone leave git reporting no upstream at all.
    repo.git(&["config", "remote.origin.url", "."]);
    repo.git(&["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
    repo.git(&["update-ref", "refs/remotes/origin/main", &tip]);
    repo.git(&["config", "branch.main.remote", "origin"]);
    repo.git(&["config", "branch.main.merge", "refs/heads/main"]);
}

#[tokio::test]
async fn dropping_commits_the_upstream_has_is_reported_as_published() {
    let repo = three();
    with_upstream(&repo);

    let found = impact(repo.git_api(), "HEAD~2").await.unwrap();

    assert_eq!(found.upstream.as_deref(), Some("origin/main"));
    assert_eq!(found.dropped, 2);
    assert_eq!(found.published, 2, "both are on the branch other people pull");
}

#[tokio::test]
async fn commits_the_upstream_has_not_seen_are_not_published() {
    let repo = three();
    with_upstream(&repo);

    // One commit past the remote: local work, nobody else's problem.
    repo.write("work.txt", "one\ntwo\nthree\n");
    repo.commit_all("Fourth");

    let found = impact(repo.git_api(), "HEAD~1").await.unwrap();

    assert_eq!(found.dropped, 1);
    assert_eq!(found.published, 0, "the remote never had this one");
}

#[tokio::test]
async fn a_partly_published_reset_reports_only_the_published_part() {
    // The case the warning exists for: some of what is being dropped is
    // yours alone and some of it is not.
    let repo = three();
    with_upstream(&repo);

    repo.write("work.txt", "one\ntwo\nthree\n");
    repo.commit_all("Fourth");

    let found = impact(repo.git_api(), "HEAD~3").await.unwrap();

    assert_eq!(found.dropped, 3);
    assert_eq!(found.published, 2);
}

#[tokio::test]
async fn a_revert_adds_a_commit_rather_than_removing_one() {
    let repo = three();
    let before = repo.git(&["rev-list", "--count", "HEAD"]);

    revert(repo.git_api(), "HEAD").await.unwrap();

    let after = repo.git(&["rev-list", "--count", "HEAD"]);
    assert_ne!(before.trim(), after.trim());
    assert_eq!(after.trim().parse::<usize>().unwrap(), before.trim().parse::<usize>().unwrap() + 1);

    // Still in the history, which is the point: nothing was rewritten.
    assert!(subjects(&repo).contains("Third"));
}

#[tokio::test]
async fn a_revert_undoes_what_the_commit_did() {
    let repo = three();

    revert(repo.git_api(), "HEAD").await.unwrap();

    assert_eq!(repo.read("work.txt"), "one\n");
}

#[tokio::test]
async fn reverting_an_older_commit_leaves_the_newer_ones_alone() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("Add a");
    repo.write("b.txt", "b\n");
    repo.commit_all("Add b");

    revert(repo.git_api(), "HEAD~1").await.unwrap();

    assert!(!repo.exists("a.txt"), "the reverted commit's file is gone");
    assert!(repo.exists("b.txt"), "the commit after it is untouched");
}
