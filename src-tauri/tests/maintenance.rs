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

#[tokio::test]
async fn only_leftovers_a_clean_up_removes_ask_for_one() {
    // `gc` keeps a temporary file younger than two weeks -- a fetch may still
    // be writing it -- and never touches a file it does not recognise. Counted,
    // they asked for a clean-up that could not clear them, for ever.
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("A");
    repo.git(&["gc", "--quiet"]);

    let pack = repo.path().join(".git/objects/pack");
    std::fs::write(pack.join("tmp_pack_young"), "x").unwrap();
    std::fs::write(pack.join("notes.txt"), "x").unwrap();

    let health_now = health(repo.git_api()).await.unwrap();
    assert_eq!(health_now.garbage, 0, "{health_now:?}");
    assert!(health_now.reasons.is_empty(), "{health_now:?}");

    // Old enough, it is gc's to remove, and worth asking for.
    let old = std::fs::File::options()
        .write(true)
        .create(true)
        .truncate(true)
        .open(pack.join("tmp_pack_old"))
        .unwrap();
    let month_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(30 * 24 * 60 * 60);
    old.set_modified(month_ago).unwrap();
    drop(old);

    let before = health(repo.git_api()).await.unwrap();
    assert_eq!(before.garbage, 1, "{before:?}");
    assert_eq!(before.reasons.len(), 1, "{before:?}");

    gc(repo.git_api()).await.unwrap();

    let after = health(repo.git_api()).await.unwrap();
    assert_eq!(after.garbage, 0, "{after:?}");
    assert!(after.reasons.is_empty(), "the prompt clears once it has been acted on");
}
