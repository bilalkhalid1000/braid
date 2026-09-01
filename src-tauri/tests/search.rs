//! Searching, against repositories git actually built.
//!
//! The line parser has unit tests over strings written by hand. These check
//! what those cannot: that the right git is invoked with the right flags, and
//! that a query typed into a box behaves like a thing to find rather than a
//! pattern to compile.

mod common;

use braid_lib::git::{search, SearchKind};
use common::TestRepo;

#[tokio::test]
async fn finds_a_commit_by_its_message() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("Teach the parser about renames");
    repo.write("b.txt", "b\n");
    repo.commit_all("Something else entirely");

    let found = search(repo.git_api(), "renames", SearchKind::Commits).await.unwrap();

    assert_eq!(found.commits.len(), 1);
    assert_eq!(found.commits[0].subject, "Teach the parser about renames");
}

#[tokio::test]
async fn finds_a_commit_by_its_author() {
    // One query, either field: searching a name should find that person's
    // work without the caller having to say which field it meant.
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.git(&["add", "-A"]);
    repo.git(&["-c", "user.name=Grace Hopper", "-c", "user.email=grace@example.com",
               "commit", "-m", "Unrelated subject"]);

    let found = search(repo.git_api(), "Grace", SearchKind::Commits).await.unwrap();

    assert_eq!(found.commits.len(), 1);
    assert_eq!(found.commits[0].author, "Grace Hopper");
}

#[tokio::test]
async fn a_commit_search_ignores_case() {
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("Fix the Parser");

    let found = search(repo.git_api(), "parser", SearchKind::Commits).await.unwrap();

    assert_eq!(found.commits.len(), 1);
}

#[tokio::test]
async fn a_query_is_text_to_find_not_a_pattern_to_compile() {
    // Typed into a search box, "fix(parser)" is a thing to look for. As a
    // regex it is a group, and `a[b` would be an error rather than a search.
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("fix(parser): stop at the first NUL");

    let found = search(repo.git_api(), "fix(parser)", SearchKind::Commits).await.unwrap();
    assert_eq!(found.commits.len(), 1);

    let broken = search(repo.git_api(), "a[b", SearchKind::Commits).await;
    assert!(broken.is_ok(), "an unbalanced bracket is a search, not a failure");
}

#[tokio::test]
async fn finds_a_line_of_code() {
    let repo = TestRepo::new();
    repo.write("src/main.rs", "fn main() {\n    let answer = 42;\n}\n");
    repo.commit_all("Add main");

    let found = search(repo.git_api(), "answer", SearchKind::Code).await.unwrap();

    assert_eq!(found.code.len(), 1);
    assert_eq!(found.code[0].path, "src/main.rs");
    assert_eq!(found.code[0].line, 2);
    assert_eq!(found.code[0].text, "    let answer = 42;");
}

#[tokio::test]
async fn a_code_search_that_matches_nothing_is_not_an_error() {
    // git grep exits 1 when nothing matched. That is an answer, and treating
    // it as a failure would turn every unsuccessful search into an error box.
    let repo = TestRepo::new();
    repo.write("a.txt", "nothing to see\n");
    repo.commit_all("One");

    let found = search(repo.git_api(), "absent", SearchKind::Code).await.unwrap();

    assert!(found.code.is_empty());
}

#[tokio::test]
async fn finds_a_file_by_part_of_its_path() {
    let repo = TestRepo::new();
    repo.write("src/components/Toolbar.tsx", "x\n");
    repo.write("docs/toolbar.md", "y\n");
    repo.write("src/main.rs", "z\n");
    repo.commit_all("Several files");

    let found = search(repo.git_api(), "toolbar", SearchKind::Files).await.unwrap();

    assert_eq!(found.files.len(), 2, "matches on path, and ignores case");
    assert!(found.files.iter().any(|p| p.ends_with("Toolbar.tsx")));
}

#[tokio::test]
async fn an_empty_query_searches_for_nothing() {
    // Otherwise the first keystroke's worth of empty box returns the entire
    // repository, which is slow and says nothing.
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.commit_all("One");

    for kind in [SearchKind::Commits, SearchKind::Code, SearchKind::Files] {
        let found = search(repo.git_api(), "   ", kind).await.unwrap();

        assert!(found.commits.is_empty());
        assert!(found.code.is_empty());
        assert!(found.files.is_empty());
    }
}

#[tokio::test]
async fn searching_an_empty_repository_finds_nothing_rather_than_failing() {
    // No HEAD to walk is what git calls an error and what a new repository
    // calls Tuesday.
    let repo = TestRepo::empty();

    let found = search(repo.git_api(), "anything", SearchKind::Commits).await.unwrap();
    assert!(found.commits.is_empty());
}
