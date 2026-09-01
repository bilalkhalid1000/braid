//! Cloning, against real repositories on disk.
//!
//! The progress parser has unit tests over lines written by hand. These check
//! the part those cannot: that git is actually driven correctly, that the
//! result is a repository, and that a clone which cannot succeed fails with
//! something worth reading instead of hanging.

mod common;

use std::sync::{Arc, Mutex};

use braid_lib::git::{clone, CloneProgress};
use common::TestRepo;

/// A destination beside the source repository, named after it.
///
/// TestRepo directories sit directly in the system temp dir, so a fixed name
/// like "cloned-here" would be shared by every test binary running at once.
fn beside(repo: &TestRepo, suffix: &str) -> std::path::PathBuf {
    let dir = repo.path();
    let name = dir.file_name().unwrap().to_string_lossy().into_owned();
    dir.parent().unwrap().join(format!("{name}-{suffix}"))
}

/// A `file://` URL for a repository on disk.
///
/// Cloning a plain path lets git take the local shortcut: it hardlinks the
/// object store instead of transferring anything, so there is no transfer to
/// report and `--progress` says nothing. That is correct behaviour and makes a
/// plain path useless for testing that progress arrives. A file:// URL goes
/// through the ordinary transport, which counts and sends objects like any
/// other clone.
fn file_url(repo: &TestRepo) -> String {
    let path = repo.path().display().to_string().replace('\\', "/");
    format!("file:///{}", path.trim_start_matches('/'))
}

/// Collect whatever progress the clone reports.
fn recorder() -> (Arc<Mutex<Vec<CloneProgress>>>, impl FnMut(CloneProgress)) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    (seen, move |p| sink.lock().unwrap().push(p))
}

#[tokio::test]
async fn clones_a_local_repository_and_brings_its_history() {
    let source = TestRepo::new();
    source.write("cloned.txt", "brought along\n");
    source.commit_all("Add a file to carry over");

    let into = beside(&source, "clone");
    let (_seen, on_progress) = recorder();

    let root = clone(&source.path().display().to_string(), &into, on_progress)
        .await
        .unwrap();

    assert!(root.join(".git").exists(), "the clone is a repository");
    assert!(root.join("cloned.txt").exists(), "and it has the work");

    let _ = std::fs::remove_dir_all(&into);
}

#[tokio::test]
async fn creates_the_parent_directory_it_was_given() {
    // Cloning into "somewhere/new/repo" should not fail because "somewhere/new"
    // does not exist yet -- the user picked a destination, not a parent that
    // must already be there.
    let source = TestRepo::new();
    source.write("a.txt", "a\n");
    source.commit_all("One");

    let nested = beside(&source, "deep").join("nested").join("repo");
    let (_seen, on_progress) = recorder();

    let root = clone(&source.path().display().to_string(), &nested, on_progress)
        .await
        .unwrap();

    assert!(root.join(".git").exists());

    let _ = std::fs::remove_dir_all(beside(&source, "deep"));
}

#[tokio::test]
async fn refuses_a_destination_that_already_has_files_in_it() {
    let source = TestRepo::new();
    source.write("a.txt", "a\n");
    source.commit_all("One");

    // The source itself is a non-empty directory, so it stands in for one.
    let (_seen, on_progress) = recorder();
    let result = clone(
        &source.path().display().to_string(),
        source.path(),
        on_progress,
    )
    .await;

    let error = result.expect_err("cloning onto a non-empty directory cannot work");
    let text = format!("{error:?}");
    assert!(
        text.contains("already exists"),
        "the error should say what is in the way, got: {text}",
    );
}

#[tokio::test]
async fn a_url_that_does_not_resolve_fails_rather_than_hanging() {
    // GIT_TERMINAL_PROMPT=0 is what makes this a failure instead of a process
    // waiting forever for a password nobody can type into it.
    let repo = TestRepo::new();
    let into = beside(&repo, "never-cloned");

    let (_seen, on_progress) = recorder();
    let result = clone(
        &repo.path().join("no-such-repository").display().to_string(),
        &into,
        on_progress,
    )
    .await;

    assert!(result.is_err(), "a missing source is an error");
    assert!(!into.exists() || std::fs::read_dir(&into).unwrap().next().is_none());

    let _ = std::fs::remove_dir_all(&into);
}

#[tokio::test]
async fn reports_progress_while_it_works() {
    let source = TestRepo::new();
    for n in 0..40 {
        source.write(&format!("file{n}.txt"), &"x".repeat(400));
    }
    source.commit_all("Enough objects to count");

    let into = beside(&source, "progress");
    let (seen, on_progress) = recorder();

    clone(&file_url(&source), &into, on_progress).await.unwrap();

    let updates = seen.lock().unwrap();
    assert!(
        !updates.is_empty(),
        "a clone that reports nothing is indistinguishable from one that hung",
    );
    assert!(
        updates.iter().all(|p| !p.phase.is_empty()),
        "every update names the phase it is in",
    );

    let _ = std::fs::remove_dir_all(&into);
}
