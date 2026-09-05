//! Bisect, read back from git's refs.

mod common;

use braid_lib::git::bisect::{mark, reset, status, Verdict};
use common::TestRepo;

/// Six commits on main, returned oldest first.
fn six(repo: &TestRepo) -> Vec<String> {
    let mut oids = vec![repo.head()];
    for n in 1..=5 {
        repo.write("n.txt", &format!("{n}\n"));
        repo.commit_all(&format!("Step {n}"));
        oids.push(repo.head());
    }
    oids
}

#[tokio::test]
async fn nothing_running_reads_as_inactive() {
    let repo = TestRepo::new();
    assert!(!status(repo.git_api()).await.unwrap().active);
}

#[tokio::test]
async fn marking_starts_the_bisect_and_reads_both_ends_back() {
    let repo = TestRepo::new();
    let oids = six(&repo);

    mark(repo.git_api(), Verdict::Bad, &oids[5]).await.unwrap();
    let after_bad = status(repo.git_api()).await.unwrap();
    assert!(after_bad.active);
    assert_eq!(after_bad.bad.as_deref(), Some(oids[5].as_str()));
    assert_eq!(after_bad.remaining, None);

    let said = mark(repo.git_api(), Verdict::Good, &oids[0]).await.unwrap();
    assert!(said.contains("revisions left"), "{said}");

    let s = status(repo.git_api()).await.unwrap();
    assert_eq!(s.good, vec![oids[0].clone()]);
    assert!(s.remaining.is_some());
    assert!(s.steps.is_some());
    // HEAD has moved to a commit in the middle, to be tested.
    let head = repo.head();
    assert!(oids[1..5].contains(&head), "{head}");
}

#[tokio::test]
async fn skips_are_listed_and_reset_goes_home() {
    let repo = TestRepo::new();
    let oids = six(&repo);
    mark(repo.git_api(), Verdict::Bad, &oids[5]).await.unwrap();
    mark(repo.git_api(), Verdict::Good, &oids[0]).await.unwrap();

    let testing = repo.head();
    mark(repo.git_api(), Verdict::Skip, &testing).await.unwrap();
    assert_eq!(status(repo.git_api()).await.unwrap().skipped, vec![testing]);

    reset(repo.git_api()).await.unwrap();
    assert!(!status(repo.git_api()).await.unwrap().active);
    assert_eq!(repo.head(), oids[5]);
    assert_eq!(repo.git(&["branch", "--show-current"]).trim(), "main");
}
