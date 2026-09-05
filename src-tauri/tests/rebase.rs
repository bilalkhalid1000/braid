//! Interactive rebase, decided in advance and handed to git.

mod common;

use braid_lib::git::rebase::{amend_into, plan, run, Action, Step};
use common::TestRepo;

/// main: A (initial) B C D, one file each.
fn four(repo: &TestRepo) -> Vec<String> {
    let mut oids = vec![repo.head()];
    for name in ["b", "c", "d"] {
        repo.write(&format!("{name}.txt"), &format!("{name}\n"));
        repo.commit_all(&format!("Add {name}"));
        oids.push(repo.head());
    }
    oids
}

fn subjects(repo: &TestRepo) -> Vec<String> {
    repo.git(&["log", "--format=%s", "--reverse"])
        .lines()
        .map(str::to_string)
        .collect()
}

fn step(action: Action, oid: &str) -> Step {
    Step { action, oid: oid.to_string(), message: None }
}

#[tokio::test]
async fn the_plan_lists_the_run_oldest_first_from_the_parent() {
    let repo = TestRepo::new();
    let oids = four(&repo);

    let plan = plan(repo.git_api(), &oids[1]).await.unwrap();

    assert_eq!(plan.base, oids[0]);
    let listed: Vec<&str> = plan.commits.iter().map(|c| c.oid.as_str()).collect();
    assert_eq!(listed, vec![oids[1].as_str(), oids[2].as_str(), oids[3].as_str()]);
    assert_eq!(plan.commits[0].subject, "Add b");
    assert_eq!(plan.commits[0].message, "Add b");
    assert_eq!(plan.published, 0);
}

#[tokio::test]
async fn a_commit_off_the_branch_is_refused() {
    let repo = TestRepo::new();
    four(&repo);
    repo.git(&["checkout", "-b", "other", "HEAD~2"]);
    repo.write("x.txt", "x\n");
    repo.commit_all("Elsewhere");
    let elsewhere = repo.head();
    repo.git(&["checkout", "main"]);

    assert!(plan(repo.git_api(), &elsewhere).await.is_err());
}

#[tokio::test]
async fn reorders_and_drops() {
    let repo = TestRepo::new();
    let oids = four(&repo);
    let plan = plan(repo.git_api(), &oids[1]).await.unwrap();

    run(
        repo.git_api(),
        &plan.base,
        &[
            step(Action::Drop, &oids[1]),
            step(Action::Pick, &oids[3]),
            step(Action::Pick, &oids[2]),
        ],
    )
    .await
    .unwrap();

    assert_eq!(subjects(&repo), vec!["Initial commit", "Add d", "Add c"]);
    assert!(!repo.exists("b.txt"));
    assert!(repo.exists("c.txt") && repo.exists("d.txt"));
}

#[tokio::test]
async fn rewords_without_an_editor() {
    let repo = TestRepo::new();
    let oids = four(&repo);
    let plan = plan(repo.git_api(), &oids[1]).await.unwrap();

    run(
        repo.git_api(),
        &plan.base,
        &[
            step(Action::Pick, &oids[1]),
            Step {
                action: Action::Reword,
                oid: oids[2].clone(),
                message: Some("Add c, properly\n\nWith a body.".into()),
            },
            step(Action::Pick, &oids[3]),
        ],
    )
    .await
    .unwrap();

    assert_eq!(subjects(&repo), vec!["Initial commit", "Add b", "Add c, properly", "Add d"]);
    let body = repo.git(&["log", "-1", "--format=%b", "HEAD~1"]);
    assert_eq!(body.trim(), "With a body.");
}

#[tokio::test]
async fn squash_keeps_both_messages_and_fixup_keeps_one() {
    let repo = TestRepo::new();
    let oids = four(&repo);
    let plan = plan(repo.git_api(), &oids[1]).await.unwrap();

    run(
        repo.git_api(),
        &plan.base,
        &[
            step(Action::Pick, &oids[1]),
            step(Action::Squash, &oids[2]),
            step(Action::Fixup, &oids[3]),
        ],
    )
    .await
    .unwrap();

    assert_eq!(subjects(&repo).len(), 2);
    let message = repo.git(&["log", "-1", "--format=%B"]);
    assert!(message.contains("Add b"), "{message}");
    assert!(message.contains("Add c"), "{message}");
    assert!(!message.contains("Add d"), "{message}");
    assert!(repo.exists("b.txt") && repo.exists("c.txt") && repo.exists("d.txt"));
}

#[tokio::test]
async fn dropping_everything_is_refused() {
    let repo = TestRepo::new();
    let oids = four(&repo);
    let plan = plan(repo.git_api(), &oids[1]).await.unwrap();

    let result = run(
        repo.git_api(),
        &plan.base,
        &[step(Action::Drop, &oids[1]), step(Action::Drop, &oids[2]), step(Action::Drop, &oids[3])],
    )
    .await;

    assert!(result.is_err());
    assert_eq!(subjects(&repo).len(), 4);
}

#[tokio::test]
async fn staged_changes_fold_into_an_older_commit() {
    let repo = TestRepo::new();
    let oids = four(&repo);

    repo.write("b.txt", "b, improved\n");
    repo.git(&["add", "b.txt"]);
    // Unstaged work elsewhere must neither block the rebase nor be lost.
    repo.write("scratch.txt", "not yet\n");

    amend_into(repo.git_api(), &oids[1]).await.unwrap();

    assert_eq!(subjects(&repo), vec!["Initial commit", "Add b", "Add c", "Add d"]);
    let b_then = repo.git(&["show", "HEAD~2:b.txt"]);
    assert_eq!(b_then, "b, improved\n");
    assert_eq!(repo.read("scratch.txt"), "not yet\n");
}

#[tokio::test]
async fn amending_with_nothing_staged_is_refused() {
    let repo = TestRepo::new();
    let oids = four(&repo);

    assert!(amend_into(repo.git_api(), &oids[1]).await.is_err());
    assert_eq!(subjects(&repo).len(), 4);
}
