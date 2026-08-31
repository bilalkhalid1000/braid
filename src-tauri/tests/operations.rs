//! In-progress operations, conflicts, worktrees, submodules and git flow.

mod common;

use braid_lib::git::flow::{FinishOptions, FlowConfig, FlowKind};
use braid_lib::git::{flow, operation, status, submodule, worktree, RepoState};
use common::TestRepo;

/// Two branches that changed the same line, ready to collide.
fn conflicting(repo: &TestRepo) {
    repo.write("shared.txt", "original\n");
    repo.commit_all("Add a shared file");

    repo.git(&["checkout", "-b", "other"]);
    repo.write("shared.txt", "from the other branch\n");
    repo.commit_all("Other change");

    repo.git(&["checkout", "main"]);
    repo.write("shared.txt", "from main\n");
    repo.commit_all("Main change");
}

// --- operation state -------------------------------------------------------

#[tokio::test]
async fn a_clean_repository_reports_no_operation() {
    let repo = TestRepo::new();
    assert_eq!(operation::detect(repo.git_api()).await.unwrap(), RepoState::Clean);
}

#[tokio::test]
async fn a_conflicted_merge_is_reported_as_merging() {
    let repo = TestRepo::new();
    conflicting(&repo);

    // Expected to fail: that is the state under test.
    assert!(!repo.git_allow_failure(&["merge", "other"]));

    let state = operation::detect(repo.git_api()).await.unwrap();
    assert_eq!(state, RepoState::Merging);

    let result = status(repo.git_api()).await.unwrap();
    assert_eq!(result.conflicted_count, 1);
    assert_eq!(result.state, RepoState::Merging);
}

#[tokio::test]
async fn a_conflicted_rebase_reports_rebasing_not_merging() {
    // Git writes MERGE_HEAD during a conflicted rebase too. Answering
    // "merging" would offer `merge --abort`, which does not get the user out.
    let repo = TestRepo::new();
    conflicting(&repo);

    assert!(!repo.git_allow_failure(&["rebase", "other"]));

    assert_eq!(
        operation::detect(repo.git_api()).await.unwrap(),
        RepoState::Rebasing,
    );
}

#[tokio::test]
async fn aborting_a_merge_returns_the_repository_to_rest() {
    let repo = TestRepo::new();
    conflicting(&repo);
    assert!(!repo.git_allow_failure(&["merge", "other"]));

    operation::abort(repo.git_api()).await.unwrap();

    assert_eq!(operation::detect(repo.git_api()).await.unwrap(), RepoState::Clean);
    assert_eq!(repo.read("shared.txt"), "from main\n");
}

#[tokio::test]
async fn continuing_a_merge_after_resolving_creates_the_commit() {
    let repo = TestRepo::new();
    conflicting(&repo);
    assert!(!repo.git_allow_failure(&["merge", "other"]));

    repo.write("shared.txt", "resolved by hand\n");
    repo.git(&["add", "shared.txt"]);

    operation::continue_operation(repo.git_api()).await.unwrap();

    assert_eq!(operation::detect(repo.git_api()).await.unwrap(), RepoState::Clean);

    // The editor would otherwise block forever here; `core.editor=true` is what
    // stops that, and this is the test that would catch its removal.
    let log = repo.git(&["log", "--oneline", "-1"]);
    assert!(!log.is_empty());
}

#[tokio::test]
async fn continuing_with_conflicts_still_unresolved_is_refused() {
    let repo = TestRepo::new();
    conflicting(&repo);
    assert!(!repo.git_allow_failure(&["merge", "other"]));

    // Nothing staged, so the merge is not resolved.
    let result = operation::continue_operation(repo.git_api()).await;

    assert!(result.is_err(), "a half-resolved merge must not be recorded");
}

#[tokio::test]
async fn there_is_nothing_to_abort_when_nothing_is_running() {
    let repo = TestRepo::new();
    assert!(operation::abort(repo.git_api()).await.is_err());
}

// --- conflict resolution ---------------------------------------------------

#[tokio::test]
async fn taking_one_side_resolves_the_file_and_stages_it() {
    let repo = TestRepo::new();
    conflicting(&repo);
    assert!(!repo.git_allow_failure(&["merge", "other"]));

    repo.git(&["checkout", "--theirs", "--", "shared.txt"]);
    repo.git(&["add", "--", "shared.txt"]);

    assert_eq!(repo.read("shared.txt"), "from the other branch\n");

    let result = status(repo.git_api()).await.unwrap();
    assert_eq!(result.conflicted_count, 0);
    assert_eq!(result.staged_count, 1);
}

// --- worktrees -------------------------------------------------------------

#[tokio::test]
async fn a_plain_repository_has_exactly_one_worktree() {
    let repo = TestRepo::new();
    let trees = worktree::list(repo.git_api()).await.unwrap();

    assert_eq!(trees.len(), 1);
    assert!(trees[0].is_main);
    assert_eq!(trees[0].branch.as_deref(), Some("main"));
}

#[tokio::test]
async fn adding_a_worktree_lists_it_alongside_the_main_one() {
    let repo = TestRepo::new();
    let extra = repo.path().parent().unwrap().join(format!(
        "{}-wt",
        repo.path().file_name().unwrap().to_string_lossy()
    ));
    let extra_path = extra.to_string_lossy().to_string();

    worktree::add(repo.git_api(), &extra_path, "side", true)
        .await
        .unwrap();

    let trees = worktree::list(repo.git_api()).await.unwrap();
    assert_eq!(trees.len(), 2);

    let side = trees.iter().find(|w| !w.is_main).unwrap();
    assert_eq!(side.branch.as_deref(), Some("side"));

    worktree::remove(repo.git_api(), &extra_path, false).await.unwrap();
    assert_eq!(worktree::list(repo.git_api()).await.unwrap().len(), 1);

    let _ = std::fs::remove_dir_all(&extra);
}

#[tokio::test]
async fn adding_a_worktree_for_a_branch_that_does_not_exist_is_refused() {
    let repo = TestRepo::new();
    let extra = repo.path().parent().unwrap().join("braid-missing-branch-wt");

    // `new_branch: false` says the branch should already exist.
    let result = worktree::add(
        repo.git_api(),
        &extra.to_string_lossy(),
        "no-such-branch",
        false,
    )
    .await;

    assert!(result.is_err());
    let _ = std::fs::remove_dir_all(&extra);
}

// --- submodules ------------------------------------------------------------

#[tokio::test]
async fn a_repository_without_submodules_lists_none() {
    let repo = TestRepo::new();
    assert!(submodule::list(repo.git_api()).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_submodule_is_listed_with_its_url() {
    let inner = TestRepo::new();
    let outer = TestRepo::new();

    // Local paths need this since git 2.38 refused file:// submodules by
    // default; the test is about listing, not about the transport.
    outer.git(&["-c", "protocol.file.allow=always", "submodule", "add", "--quiet",
                &inner.path().to_string_lossy(), "vendor/lib"]);
    outer.commit_all("Add a submodule");

    let modules = submodule::list(outer.git_api()).await.unwrap();

    assert_eq!(modules.len(), 1);
    assert_eq!(modules[0].path, "vendor/lib");
    assert!(modules[0].url.is_some(), "the URL comes from .gitmodules");
}

// --- git flow --------------------------------------------------------------

#[tokio::test]
async fn flow_is_not_set_up_until_it_is_initialised() {
    let repo = TestRepo::new();
    let before = flow::status(repo.git_api()).await.unwrap();
    assert!(!before.initialized);

    // The production branch defaults to whatever is checked out, rather than
    // proposing "main" to someone whose trunk is "master".
    assert_eq!(before.config.master, "main");

    flow::init(repo.git_api(), &FlowConfig::default()).await.unwrap();

    let after = flow::status(repo.git_api()).await.unwrap();
    assert!(after.initialized);
    assert!(after.develop_exists);
}

#[tokio::test]
async fn starting_a_feature_branches_from_develop_and_checks_it_out() {
    let repo = TestRepo::new();
    flow::init(repo.git_api(), &FlowConfig::default()).await.unwrap();

    flow::start(repo.git_api(), FlowKind::Feature, "login")
        .await
        .unwrap();

    let state = flow::status(repo.git_api()).await.unwrap();
    let current = state.current.expect("HEAD should be on a flow branch");

    assert_eq!(current.kind, FlowKind::Feature);
    assert_eq!(current.name, "login");
    assert_eq!(current.branch, "feature/login");
}

#[tokio::test]
async fn finishing_a_feature_merges_it_into_develop_and_deletes_it() {
    let repo = TestRepo::new();
    flow::init(repo.git_api(), &FlowConfig::default()).await.unwrap();

    flow::start(repo.git_api(), FlowKind::Feature, "login").await.unwrap();
    repo.write("login.txt", "work\n");
    repo.commit_all("Feature work");

    flow::finish(
        repo.git_api(),
        FlowKind::Feature,
        "login",
        &FinishOptions {
            delete_branch: true,
            push: false,
            tag_message: String::new(),
        },
    )
    .await
    .unwrap();

    assert_eq!(repo.git(&["rev-parse", "--abbrev-ref", "HEAD"]).trim(), "develop");
    assert!(repo.exists("login.txt"), "the work should be on develop now");

    let branches = repo.git(&["branch", "--list", "feature/login"]);
    assert!(branches.trim().is_empty(), "the branch should be gone");
}

#[tokio::test]
async fn finishing_a_release_tags_it_and_lands_on_both_branches() {
    let repo = TestRepo::new();
    flow::init(repo.git_api(), &FlowConfig::default()).await.unwrap();

    flow::start(repo.git_api(), FlowKind::Release, "1.0.0").await.unwrap();
    repo.write("changelog.txt", "1.0.0\n");
    repo.commit_all("Prepare the release");

    flow::finish(
        repo.git_api(),
        FlowKind::Release,
        "1.0.0",
        &FinishOptions {
            delete_branch: true,
            push: false,
            tag_message: "Release 1.0.0".into(),
        },
    )
    .await
    .unwrap();

    assert!(repo.git(&["tag", "--list", "1.0.0"]).contains("1.0.0"));

    // The tag marks the merge commit on the production branch, so only main
    // contains it. develop gets the release's *work* by merging the release
    // branch, not that merge commit — which is what git-flow does, and why
    // "on both branches" is the wrong thing to check for.
    let containing = repo.git(&["branch", "--contains", "1.0.0"]);
    assert!(containing.contains("main"));
    assert!(!containing.contains("develop"));

    // Finishing leaves you on develop, with the release work present.
    assert_eq!(repo.git(&["rev-parse", "--abbrev-ref", "HEAD"]).trim(), "develop");
    assert!(repo.exists("changelog.txt"), "develop should have the release work");
}

#[tokio::test]
async fn finishing_a_hotfix_without_deleting_keeps_the_branch() {
    // The delete checkbox is the one option in that dialog that destroys
    // something, so "off" has to mean off. A hotfix takes the longer path --
    // production, tag, then develop -- which is where an unconditional delete
    // would hide.
    let repo = TestRepo::new();
    flow::init(repo.git_api(), &FlowConfig::default()).await.unwrap();

    flow::start(repo.git_api(), FlowKind::Hotfix, "1.0.1").await.unwrap();
    repo.write("fix.txt", "patched
");
    repo.commit_all("Fix the thing");

    flow::finish(
        repo.git_api(),
        FlowKind::Hotfix,
        "1.0.1",
        &FinishOptions {
            delete_branch: false,
            push: false,
            tag_message: String::new(),
        },
    )
    .await
    .unwrap();

    assert!(
        repo.git(&["branch", "--list", "hotfix/1.0.1"]).contains("hotfix/1.0.1"),
        "the branch must survive when the delete option is off",
    );
    assert!(repo.git(&["tag", "--list", "1.0.1"]).contains("1.0.1"));
}

#[tokio::test]
async fn finishing_a_feature_without_deleting_keeps_the_branch() {
    let repo = TestRepo::new();
    flow::init(repo.git_api(), &FlowConfig::default()).await.unwrap();

    flow::start(repo.git_api(), FlowKind::Feature, "login").await.unwrap();
    repo.write("login.txt", "work
");
    repo.commit_all("Feature work");

    flow::finish(
        repo.git_api(),
        FlowKind::Feature,
        "login",
        &FinishOptions {
            delete_branch: false,
            push: false,
            tag_message: String::new(),
        },
    )
    .await
    .unwrap();

    assert!(
        repo.git(&["branch", "--list", "feature/login"]).contains("feature/login"),
        "the branch must survive when the delete option is off",
    );
}

#[tokio::test]
async fn a_support_branch_cannot_be_finished() {
    let repo = TestRepo::new();
    flow::init(repo.git_api(), &FlowConfig::default()).await.unwrap();

    let result = flow::finish(
        repo.git_api(),
        FlowKind::Support,
        "1.x",
        &FinishOptions {
            delete_branch: true,
            push: false,
            tag_message: String::new(),
        },
    )
    .await;

    assert!(result.is_err(), "support branches are long-lived by design");
}

#[tokio::test]
async fn starting_a_flow_branch_before_setup_is_refused() {
    let repo = TestRepo::new();

    let result = flow::start(repo.git_api(), FlowKind::Feature, "login").await;
    assert!(result.is_err());
}
