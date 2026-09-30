//! Object-store housekeeping, against a real repository.

mod common;

use braid_lib::git::maintenance::{gc, health};
use common::TestRepo;

#[tokio::test]
async fn gc_packs_the_loose_objects_and_says_so() {
    let repo = TestRepo::new();
    for n in 0..5 {
        repo.write(&format!("file{n}.txt"), &format!("{n}\n"));
        repo.commit_all(&format!("Commit {n}"));
    }

    let before = health(repo.git_api()).await.unwrap();
    assert!(before.loose > 0, "{before:?}");

    let summary = gc(repo.git_api()).await.unwrap();

    let after = health(repo.git_api()).await.unwrap();
    assert_eq!(after.loose, 0, "{after:?}");
    assert_eq!(after.packs, 1, "{after:?}");
    assert!(summary.starts_with(&format!("Loose objects {} → 0", before.loose)), "{summary}");

    // Nothing reachable went with them.
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]).trim(), "6");
    assert_eq!(repo.read("file3.txt"), "3\n");
}
