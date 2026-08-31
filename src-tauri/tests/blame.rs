//! Blame, against a repository git actually wrote.
//!
//! The porcelain parser has unit tests over a hand-written fixture, which
//! proves the parsing but not that git emits what the fixture claims. These
//! check the part those cannot: that real `git blame --porcelain` output, with
//! its metadata stated once per commit, comes back correctly attributed.

mod common;

use braid_lib::git::blame;
use common::TestRepo;

#[tokio::test]
async fn every_line_is_attributed_to_the_commit_that_wrote_it() {
    let repo = TestRepo::new();

    repo.write("poem.txt", "one\ntwo\n");
    repo.commit_all("First two lines");
    let first = repo.head();

    repo.write("poem.txt", "one\ntwo\nthree\n");
    repo.commit_all("A third line");
    let second = repo.head();

    let result = blame(repo.git_api(), "poem.txt", None).await.unwrap();

    assert_eq!(result.lines.len(), 3);
    assert_eq!(result.lines[0].content, "one");
    assert_eq!(result.lines[2].content, "three");

    assert_eq!(result.lines[0].oid, first);
    assert_eq!(result.lines[1].oid, first);
    assert_eq!(result.lines[2].oid, second);
}

#[tokio::test]
async fn a_commit_is_described_once_however_many_lines_it_owns() {
    let repo = TestRepo::new();

    repo.write("poem.txt", "one\ntwo\nthree\n");
    repo.commit_all("All three at once");

    let result = blame(repo.git_api(), "poem.txt", None).await.unwrap();

    // Three lines, one commit: the whole reason the porcelain format is worth
    // keeping rather than flattening into a record per line.
    assert_eq!(result.lines.len(), 3);
    assert_eq!(result.commits.len(), 1);

    let commit = &result.commits[&result.lines[0].oid];
    assert_eq!(commit.summary, "All three at once");
    assert!(!commit.author.is_empty(), "the author comes from git, not us");
    assert!(commit.author_time > 0);
    assert!(!commit.uncommitted);
}

#[tokio::test]
async fn uncommitted_edits_are_attributed_to_nobody_yet() {
    let repo = TestRepo::new();

    repo.write("poem.txt", "one\n");
    repo.commit_all("First");

    // Blaming a dirty file is the common case -- you are reading the file you
    // are editing -- and git attributes the new line to the all-zero hash.
    repo.write("poem.txt", "one\ntyped just now\n");

    let result = blame(repo.git_api(), "poem.txt", None).await.unwrap();

    assert_eq!(result.lines.len(), 2);
    assert!(!result.commits[&result.lines[0].oid].uncommitted);
    assert!(result.commits[&result.lines[1].oid].uncommitted);
}

#[tokio::test]
async fn a_revision_blames_the_file_as_it_stood_then() {
    let repo = TestRepo::new();

    repo.write("poem.txt", "one\n");
    repo.commit_all("First");
    let first = repo.head();

    repo.write("poem.txt", "one\ntwo\n");
    repo.commit_all("Second");

    let then = blame(repo.git_api(), "poem.txt", Some(&first)).await.unwrap();
    assert_eq!(then.lines.len(), 1, "the second line did not exist yet");

    let now = blame(repo.git_api(), "poem.txt", None).await.unwrap();
    assert_eq!(now.lines.len(), 2);
}

#[tokio::test]
async fn indentation_survives_the_leading_tab_of_the_format() {
    let repo = TestRepo::new();

    // The porcelain format prefixes each line with a tab. A file that is itself
    // tab-indented is where an over-eager trim would show up.
    repo.write("code.rs", "fn main() {\n\tlet x = 1;\n}\n");
    repo.commit_all("Indented");

    let result = blame(repo.git_api(), "code.rs", None).await.unwrap();

    assert_eq!(result.lines[1].content, "\tlet x = 1;");
}

#[tokio::test]
async fn a_path_that_looks_like_a_revision_is_still_a_path() {
    let repo = TestRepo::new();

    // Without `--` git would read this as a revision and fail, or worse, blame
    // something else entirely.
    repo.write("HEAD", "not a revision\n");
    repo.commit_all("Add a file called HEAD");

    let result = blame(repo.git_api(), "HEAD", None).await.unwrap();

    assert_eq!(result.lines.len(), 1);
    assert_eq!(result.lines[0].content, "not a revision");
}

#[tokio::test]
async fn blaming_a_path_that_does_not_exist_is_an_error_not_an_empty_blame() {
    let repo = TestRepo::new();

    // Silently returning nothing would render as an empty file, which reads as
    // "this file has no history" rather than "there is no such file".
    assert!(blame(repo.git_api(), "nothing.txt", None).await.is_err());
}

#[tokio::test]
async fn an_empty_file_blames_to_no_lines() {
    let repo = TestRepo::new();

    repo.write("empty.txt", "");
    repo.commit_all("An empty file");

    let result = blame(repo.git_api(), "empty.txt", None).await.unwrap();

    assert!(result.lines.is_empty());
    assert_eq!(result.path, "empty.txt");
}
