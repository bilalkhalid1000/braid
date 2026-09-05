//! Where HEAD has been, and undo.

mod common;

use braid_lib::git::reflog::{reflog, undo};
use common::TestRepo;

#[tokio::test]
async fn lists_moves_newest_first() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("Add a");
    repo.git(&["checkout", "-b", "dev"]);

    let entries = reflog(repo.git_api(), 10).await.unwrap();

    assert_eq!(entries[0].selector, "HEAD@{0}");
    assert!(entries[0].subject.starts_with("checkout: moving from main to dev"));
    assert!(entries[1].subject.contains("Add a"));
    assert_eq!(entries[0].oid, repo.head());
}

#[tokio::test]
async fn undo_takes_a_commit_back() {
    let repo = TestRepo::new();
    let before = repo.head();
    repo.write("a.txt", "a\n");
    repo.commit_all("Add a");

    let said = undo(repo.git_api()).await.unwrap();

    assert_eq!(repo.head(), before);
    assert!(!repo.exists("a.txt"));
    assert!(said.contains("Add a"), "{said}");
}

#[tokio::test]
async fn undo_of_a_checkout_goes_back_to_the_branch() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-b", "dev"]);

    undo(repo.git_api()).await.unwrap();

    assert_eq!(repo.git(&["branch", "--show-current"]).trim(), "main");
}

#[tokio::test]
async fn undo_refuses_to_take_uncommitted_work_with_it() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("Add a");
    let after = repo.head();
    repo.write("a.txt", "a, changed\n");

    assert!(undo(repo.git_api()).await.is_err());
    assert_eq!(repo.head(), after);
    assert_eq!(repo.read("a.txt"), "a, changed\n");
}
