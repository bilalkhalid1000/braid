//! Remotes as the sidebar lists them.

mod common;

use braid_lib::git::refs;
use common::TestRepo;

#[tokio::test]
async fn a_remote_with_no_branches_is_listed_with_its_url() {
    let repo = TestRepo::new();
    repo.git(&["remote", "add", "upstream", "https://example.com/repo.git"]);

    let snapshot = refs(repo.git_api()).await.unwrap();

    let upstream = snapshot.remotes.iter().find(|r| r.name == "upstream").unwrap();
    assert_eq!(upstream.url, "https://example.com/repo.git");
    assert!(upstream.branches.is_empty());
}

#[tokio::test]
async fn a_removed_remote_disappears() {
    let repo = TestRepo::new();
    repo.git(&["remote", "add", "upstream", "https://example.com/repo.git"]);
    repo.git(&["remote", "remove", "upstream"]);

    let snapshot = refs(repo.git_api()).await.unwrap();
    assert!(snapshot.remotes.iter().all(|r| r.name != "upstream"));
}
