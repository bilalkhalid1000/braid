use std::path::PathBuf;

use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, Result};
use crate::git::status::EntryKind;
use crate::git::{
    self, Blame, CloneProgress, CommitDetail, SearchKind, SearchResults, DiffOptions, DiffTarget, FileDiff, FinishOptions, FlowConfig, FlowKind, FlowStatus, Git,
    LogPage, RefsSnapshot, RepoStatus, Submodule, Worktree,
};
use crate::registry::{RepoInfo, RepoRegistry};
use crate::library::{self, Library};
use crate::session::{self, Session};
use crate::settings;
use crate::system;

// --- repositories ---------------------------------------------------------

#[tauri::command]
pub async fn open_repo(
    app: AppHandle,
    registry: State<'_, RepoRegistry>,
    path: String,
) -> Result<RepoInfo> {
    registry.open(&app, &PathBuf::from(path)).await
}

/// Create a repository at `path` and open it.
///
/// The folder is created if it does not exist. Initializing inside a folder
/// that already has files is a normal thing to want — it is how an existing
/// project starts being tracked — so it is allowed rather than blocked.
#[tauri::command]
pub async fn init_repo(
    app: AppHandle,
    registry: State<'_, RepoRegistry>,
    path: String,
    initial_branch: String,
) -> Result<RepoInfo> {
    let dir = PathBuf::from(&path);
    tokio::fs::create_dir_all(&dir).await?;

    // Already a repository: `git init` would only print "Reinitialized", and
    // opening it is what the user actually wanted. Checked on this exact folder
    // rather than by discovery, so creating a repo nested inside another one
    // does not silently open the parent instead.
    let existing = tokio::fs::try_exists(dir.join(".git")).await.unwrap_or(false);

    if !existing {
        let git = Git::new(&dir);
        let mut args = vec!["init"];

        // An empty name means "use whatever init.defaultBranch is set to",
        // which is the right default: it is the user's own git config.
        let branch_flag;
        if !initial_branch.is_empty() {
            branch_flag = format!("--initial-branch={initial_branch}");
            args.push(&branch_flag);
        }

        git.run_reported(&args).await?;
    }

    registry.open(&app, &dir).await
}

#[tauri::command]
pub fn close_repo(registry: State<'_, RepoRegistry>, id: String) {
    registry.close(&id);
}

#[tauri::command]
pub fn list_repos(registry: State<'_, RepoRegistry>) -> Vec<RepoInfo> {
    registry.list()
}

/// The repositories that were open when the app last closed.
#[tauri::command]
pub async fn load_session(app: AppHandle) -> Result<Session> {
    Ok(session::load(&app).await)
}

#[tauri::command]
pub async fn save_session(app: AppHandle, session: Session) -> Result<()> {
    session::save(&app, &session).await
}

/// The repositories the user has added, open or not.
#[tauri::command]
pub async fn load_library(app: AppHandle) -> Result<Library> {
    Ok(library::load(&app).await)
}

#[tauri::command]
pub async fn save_library(app: AppHandle, library: Library) -> Result<()> {
    library::save(&app, &library).await
}

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<serde_json::Value> {
    Ok(settings::load(&app).await)
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: serde_json::Value) -> Result<()> {
    crate::settings::save(&app, &settings).await
}

// --- reads ----------------------------------------------------------------

#[tauri::command]
pub async fn repo_status(registry: State<'_, RepoRegistry>, id: String) -> Result<RepoStatus> {
    let session = registry.get(&id)?;
    git::status(&session.git).await
}

#[tauri::command]
pub async fn repo_refs(registry: State<'_, RepoRegistry>, id: String) -> Result<RefsSnapshot> {
    let session = registry.get(&id)?;
    git::refs(&session.git).await
}

#[tauri::command]
pub async fn repo_log(
    registry: State<'_, RepoRegistry>,
    id: String,
    skip: usize,
    limit: usize,
    scope: Option<String>,
) -> Result<LogPage> {
    let session = registry.get(&id)?;
    git::log(&session.git, skip, limit, scope.as_deref().unwrap_or("all")).await
}

#[tauri::command]
pub async fn file_diff(
    registry: State<'_, RepoRegistry>,
    id: String,
    path: String,
    target: String,
    context_lines: u32,
    ignore_whitespace: bool,
) -> Result<FileDiff> {
    let session = registry.get(&id)?;

    let target = match target.as_str() {
        "staged" => DiffTarget::Staged,
        "untracked" => DiffTarget::Untracked,
        _ => DiffTarget::Worktree,
    };

    git::file_diff(
        &session.git,
        &path,
        target,
        DiffOptions {
            context_lines,
            ignore_whitespace,
        },
    )
    .await
}

/// Search the repository: commit messages and authors, code, or file paths.
#[tauri::command]
pub async fn search_repo(
    registry: State<'_, RepoRegistry>,
    id: String,
    query: String,
    kind: SearchKind,
) -> Result<SearchResults> {
    let session = registry.get(&id)?;
    git::search(&session.git, &query, kind).await
}

/// Line-by-line authorship for one file, optionally as of some revision.
/// Clone a repository and open it as a tab.
///
/// Progress is pushed to the window as it arrives rather than returned at the
/// end, because the end can be several minutes away.
#[tauri::command]
pub async fn clone_repo(
    app: AppHandle,
    registry: State<'_, RepoRegistry>,
    url: String,
    path: String,
) -> Result<RepoInfo> {
    let dir = PathBuf::from(&path);
    let progress = app.clone();

    let root = git::clone(&url, &dir, move |update: CloneProgress| {
        let _ = progress.emit(git::CLONE_PROGRESS_EVENT, update);
    })
    .await?;

    registry.open(&app, &root).await
}

#[tauri::command]
pub async fn blame_file(
    registry: State<'_, RepoRegistry>,
    id: String,
    path: String,
    rev: Option<String>,
) -> Result<Blame> {
    let session = registry.get(&id)?;
    git::blame(&session.git, &path, rev.as_deref()).await
}

#[tauri::command]
pub async fn commit_detail(
    registry: State<'_, RepoRegistry>,
    id: String,
    oid: String,
) -> Result<CommitDetail> {
    let session = registry.get(&id)?;
    git::commit::detail(&session.git, &oid).await
}

#[tauri::command]
pub async fn commit_file_diff(
    registry: State<'_, RepoRegistry>,
    id: String,
    oid: String,
    path: String,
    context_lines: u32,
    ignore_whitespace: bool,
) -> Result<FileDiff> {
    let session = registry.get(&id)?;

    git::diff::commit_file_diff(
        &session.git,
        &oid,
        &path,
        DiffOptions {
            context_lines,
            ignore_whitespace,
        },
    )
    .await
}

// --- staging --------------------------------------------------------------

/// Everything one hunk action needs.
///
/// Grouped rather than passed flat: a command with eight positional parameters
/// is one where a caller can transpose two and still compile.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HunkRequest {
    pub path: String,
    pub hunk_index: usize,
    /// Indices within the hunk, or `None` for all of it.
    pub lines: Option<Vec<usize>>,
    /// "stage", "unstage" or "discard".
    pub mode: String,
    /// The context the UI rendered with; a hunk index only means anything
    /// against a diff cut the same way.
    pub context_lines: u32,
    pub ignore_whitespace: bool,
}

/// Stage, unstage or discard one hunk — or a chosen few of its lines.
#[tauri::command]
pub async fn apply_hunk(
    registry: State<'_, RepoRegistry>,
    id: String,
    request: HunkRequest,
) -> Result<String> {
    let session = registry.get(&id)?;

    // A diff that ignores whitespace has had real changes removed from it, so a
    // patch built from one does not describe the file and will not apply. The
    // UI hides these actions in that state; this is the backstop.
    if request.ignore_whitespace {
        return Err(AppError::App(
            "Turn off \"ignore whitespace\" to stage part of a file: a patch built from that diff would not apply."
                .into(),
        ));
    }

    git::patch::apply(
        &session.git,
        &request.path,
        git::patch::Mode::parse(&request.mode)?,
        request.hunk_index,
        request.lines.as_deref(),
        request.context_lines,
    )
    .await
}

#[tauri::command]
pub async fn stage_paths(
    registry: State<'_, RepoRegistry>,
    id: String,
    paths: Vec<String>,
) -> Result<()> {
    let session = registry.get(&id)?;
    run_with_paths(&session.git, &["add"], &paths).await
}

#[tauri::command]
pub async fn unstage_paths(
    registry: State<'_, RepoRegistry>,
    id: String,
    paths: Vec<String>,
) -> Result<()> {
    let session = registry.get(&id)?;
    run_with_paths(&session.git, &["restore", "--staged"], &paths).await
}

/// Throw away working-tree changes.
///
/// Tracked and untracked files need different commands, and getting that wrong
/// destroys work, so the split is derived from git's own status rather than
/// trusted from the caller.
#[tauri::command]
pub async fn discard_paths(
    registry: State<'_, RepoRegistry>,
    id: String,
    paths: Vec<String>,
) -> Result<()> {
    let session = registry.get(&id)?;
    let status = git::status(&session.git).await?;

    let mut tracked = Vec::new();
    let mut untracked = Vec::new();

    for path in paths {
        let is_untracked = status
            .entries
            .iter()
            .any(|e| e.path == path && e.kind == EntryKind::Untracked);

        if is_untracked {
            untracked.push(path);
        } else {
            tracked.push(path);
        }
    }

    run_with_paths(&session.git, &["restore", "--worktree"], &tracked).await?;
    run_with_paths(&session.git, &["clean", "-fd"], &untracked).await
}

#[tauri::command]
pub async fn commit(
    registry: State<'_, RepoRegistry>,
    id: String,
    message: String,
    amend: bool,
) -> Result<String> {
    let session = registry.get(&id)?;

    let mut args = vec!["commit", "-m", &message];
    if amend {
        args.push("--amend");
    }

    // Git's own summary line ("[main abc1234] message, 2 files changed") is
    // more informative than the bare hash, and a failing pre-commit hook prints
    // its reason here too.
    session.git.run_reported(&args).await
}

// --- remotes --------------------------------------------------------------

#[tauri::command]
pub async fn fetch(registry: State<'_, RepoRegistry>, id: String) -> Result<String> {
    let session = registry.get(&id)?;
    session.git.run_reported(&["fetch", "--all", "--prune"]).await
}

#[tauri::command]
pub async fn pull(registry: State<'_, RepoRegistry>, id: String) -> Result<String> {
    let session = registry.get(&id)?;
    session.git.run_reported(&["pull"]).await
}

/// Push, setting an upstream on the first push of a new branch.
///
/// Git refuses to guess a remote for an untracked branch. Rather than making
/// the user discover that through an error, retry once with the obvious
/// intent, which is what they wanted by pressing Push.
#[tauri::command]
pub async fn push(registry: State<'_, RepoRegistry>, id: String) -> Result<String> {
    let session = registry.get(&id)?;

    match session.git.run_reported(&["push"]).await {
        Ok(out) => Ok(out),
        Err(AppError::Git { stderr, code }) if stderr.contains("no upstream branch") => {
            let branch = session
                .git
                .run_str(&["rev-parse", "--abbrev-ref", "HEAD"])
                .await?;

            if branch == "HEAD" {
                // Detached: there is no branch to set an upstream for.
                return Err(AppError::Git { stderr, code });
            }

            let remote = git::default_remote(&session.git).await?;

            session
                .git
                .run_reported(&["push", "--set-upstream", &remote, &branch])
                .await
        }
        Err(e) => Err(e),
    }
}

/// Push a branch and set it to track the remote it lands on.
///
/// Separate from `push` because it names the branch: publishing is the one
/// push you make for something you are not standing on.
#[tauri::command]
pub async fn publish_branch(
    registry: State<'_, RepoRegistry>,
    id: String,
    branch: String,
    remote: Option<String>,
) -> Result<String> {
    let session = registry.get(&id)?;

    let remote = match remote {
        Some(name) => name,
        None => git::default_remote(&session.git).await?,
    };

    session
        .git
        .run_reported(&["push", "--set-upstream", &remote, &branch])
        .await
}

// --- branches -------------------------------------------------------------

#[tauri::command]
pub async fn checkout(
    registry: State<'_, RepoRegistry>,
    id: String,
    name: String,
) -> Result<String> {
    let session = registry.get(&id)?;
    // "Switched to branch 'x'" and any "Your branch is behind" hint both come
    // back on stderr, and both are worth showing.
    session.git.run_reported(&["checkout", &name]).await
}

#[tauri::command]
/// Create a branch, optionally from somewhere other than HEAD.
///
/// An absent or empty `base` is left off the command entirely, which is how
/// git already spells "from where I am".
pub async fn create_branch(
    registry: State<'_, RepoRegistry>,
    id: String,
    name: String,
    checkout_after: bool,
    base: Option<String>,
) -> Result<String> {
    let session = registry.get(&id)?;
    let base = base.filter(|b| !b.trim().is_empty());

    let mut args: Vec<&str> = if checkout_after {
        vec!["checkout", "-b", &name]
    } else {
        vec!["branch", &name]
    };

    if let Some(base) = base.as_deref() {
        args.push(base);
    }

    session.git.run_reported(&args).await
}

#[tauri::command]
pub async fn delete_branch(
    registry: State<'_, RepoRegistry>,
    id: String,
    name: String,
    force: bool,
) -> Result<String> {
    let session = registry.get(&id)?;

    // `-d` refuses to drop unmerged work; only escalate when asked to.
    let flag = if force { "-D" } else { "-d" };
    session.git.run_reported(&["branch", flag, &name]).await
}

/// Delete a branch on a remote.
///
/// Separate from deleting the local one because they are separate acts with
/// separate consequences: the local copy is recoverable from the reflog for a
/// while, and the remote one is gone for everybody at once.
#[tauri::command]
pub async fn delete_remote_branch(
    registry: State<'_, RepoRegistry>,
    id: String,
    remote: String,
    branch: String,
) -> Result<String> {
    let session = registry.get(&id)?;

    session
        .git
        .run_reported(&["push", &remote, "--delete", &branch])
        .await
}

#[tauri::command]
pub async fn merge_branch(
    registry: State<'_, RepoRegistry>,
    id: String,
    name: String,
) -> Result<String> {
    let session = registry.get(&id)?;
    session.git.run_reported(&["merge", "--no-edit", &name]).await
}

// --- stash ----------------------------------------------------------------

#[tauri::command]
pub async fn stash_push(
    registry: State<'_, RepoRegistry>,
    id: String,
    message: String,
    include_untracked: bool,
) -> Result<String> {
    let session = registry.get(&id)?;

    let mut args = vec!["stash", "push"];
    if include_untracked {
        args.push("--include-untracked");
    }
    if !message.is_empty() {
        args.push("-m");
        args.push(&message);
    }

    session.git.run_reported(&args).await
}

#[tauri::command]
pub async fn stash_apply(
    registry: State<'_, RepoRegistry>,
    id: String,
    selector: String,
    pop: bool,
) -> Result<String> {
    let session = registry.get(&id)?;
    let verb = if pop { "pop" } else { "apply" };
    session.git.run_reported(&["stash", verb, &selector]).await
}

#[tauri::command]
pub async fn stash_drop(
    registry: State<'_, RepoRegistry>,
    id: String,
    selector: String,
) -> Result<String> {
    let session = registry.get(&id)?;
    session.git.run_reported(&["stash", "drop", &selector]).await
}

// --- worktrees ------------------------------------------------------------

#[tauri::command]
pub async fn list_worktrees(
    registry: State<'_, RepoRegistry>,
    id: String,
) -> Result<Vec<Worktree>> {
    let session = registry.get(&id)?;
    git::worktree::list(&session.git).await
}

#[tauri::command]
pub async fn add_worktree(
    registry: State<'_, RepoRegistry>,
    id: String,
    path: String,
    branch: String,
    new_branch: bool,
) -> Result<String> {
    let session = registry.get(&id)?;
    git::worktree::add(&session.git, &path, &branch, new_branch).await
}

#[tauri::command]
pub async fn remove_worktree(
    registry: State<'_, RepoRegistry>,
    id: String,
    path: String,
    force: bool,
) -> Result<String> {
    let session = registry.get(&id)?;
    git::worktree::remove(&session.git, &path, force).await
}

#[tauri::command]
pub async fn prune_worktrees(registry: State<'_, RepoRegistry>, id: String) -> Result<String> {
    let session = registry.get(&id)?;
    git::worktree::prune(&session.git).await
}

// --- submodules -----------------------------------------------------------

#[tauri::command]
pub async fn list_submodules(
    registry: State<'_, RepoRegistry>,
    id: String,
) -> Result<Vec<Submodule>> {
    let session = registry.get(&id)?;
    git::submodule::list(&session.git).await
}

#[tauri::command]
pub async fn update_submodules(
    registry: State<'_, RepoRegistry>,
    id: String,
    path: String,
    recursive: bool,
) -> Result<String> {
    let session = registry.get(&id)?;
    git::submodule::update(&session.git, &path, recursive).await
}

#[tauri::command]
pub async fn sync_submodules(
    registry: State<'_, RepoRegistry>,
    id: String,
    recursive: bool,
) -> Result<String> {
    let session = registry.get(&id)?;
    git::submodule::sync(&session.git, recursive).await
}

// --- git flow -------------------------------------------------------------

#[tauri::command]
pub async fn flow_status(registry: State<'_, RepoRegistry>, id: String) -> Result<FlowStatus> {
    let session = registry.get(&id)?;
    git::flow::status(&session.git).await
}

#[tauri::command]
pub async fn flow_init(
    registry: State<'_, RepoRegistry>,
    id: String,
    config: FlowConfig,
) -> Result<String> {
    let session = registry.get(&id)?;
    git::flow::init(&session.git, &config).await
}

#[tauri::command]
pub async fn flow_start(
    registry: State<'_, RepoRegistry>,
    id: String,
    kind: FlowKind,
    name: String,
) -> Result<String> {
    let session = registry.get(&id)?;
    git::flow::start(&session.git, kind, &name).await
}

#[tauri::command]
pub async fn flow_finish(
    registry: State<'_, RepoRegistry>,
    id: String,
    kind: FlowKind,
    name: String,
    options: FinishOptions,
) -> Result<String> {
    let session = registry.get(&id)?;
    git::flow::finish(&session.git, kind, &name, &options).await
}

// --- conflicts ------------------------------------------------------------

/// Resolve a conflicted file by taking one side wholesale.
///
/// "ours" and "theirs" mean different things mid-rebase than mid-merge: a
/// rebase replays your commits onto the other branch, so what git calls "ours"
/// is the branch being replayed onto. The UI names the sides rather than using
/// git's words, and the mapping is done here where the operation is known.
///
/// `side` is "ours" or "theirs", already resolved to what the user picked.
#[tauri::command]
pub async fn resolve_with_side(
    registry: State<'_, RepoRegistry>,
    id: String,
    path: String,
    side: String,
) -> Result<String> {
    let session = registry.get(&id)?;

    let flag = match side.as_str() {
        "ours" => "--ours",
        "theirs" => "--theirs",
        other => return Err(AppError::App(format!("unknown side: {other}"))),
    };

    // Checkout writes the chosen side into the worktree; staging it is what
    // actually marks the conflict resolved as far as git is concerned.
    session
        .git
        .run_reported(&["checkout", flag, "--", &path])
        .await?;

    session.git.run_reported(&["add", "--", &path]).await
}

/// Mark a conflicted file resolved using whatever is in the worktree now.
///
/// For someone who edited the file by hand and merged the sides themselves.
#[tauri::command]
pub async fn mark_resolved(
    registry: State<'_, RepoRegistry>,
    id: String,
    path: String,
) -> Result<String> {
    let session = registry.get(&id)?;
    session.git.run_reported(&["add", "--", &path]).await
}

// --- in-progress operations -----------------------------------------------

/// Abandon whatever git has half-finished and go back to where it started.
#[tauri::command]
pub async fn abort_operation(registry: State<'_, RepoRegistry>, id: String) -> Result<String> {
    let session = registry.get(&id)?;
    git::operation::abort(&session.git).await
}

/// Carry on, once the conflicts have been staged.
#[tauri::command]
pub async fn continue_operation(registry: State<'_, RepoRegistry>, id: String) -> Result<String> {
    let session = registry.get(&id)?;
    git::operation::continue_operation(&session.git).await
}

#[tauri::command]
pub async fn skip_operation(registry: State<'_, RepoRegistry>, id: String) -> Result<String> {
    let session = registry.get(&id)?;
    git::operation::skip(&session.git).await
}

// --- desktop --------------------------------------------------------------

#[tauri::command]
pub async fn open_in_file_manager(
    registry: State<'_, RepoRegistry>,
    id: String,
) -> Result<String> {
    let session = registry.get(&id)?;
    system::open_file_manager(&session.info.root).await
}

#[tauri::command]
pub async fn open_in_terminal(
    registry: State<'_, RepoRegistry>,
    id: String,
    terminal: Option<String>,
    command: Option<String>,
) -> Result<String> {
    let session = registry.get(&id)?;
    system::open_terminal(
        &session.info.root,
        terminal.as_deref().unwrap_or("auto"),
        command.as_deref().unwrap_or_default(),
    )
    .await
}

/// What a reset to this commit would throw away, asked before it is offered.
#[tauri::command]
pub async fn reset_impact(
    registry: State<'_, RepoRegistry>,
    id: String,
    oid: String,
) -> Result<git::ResetImpact> {
    let session = registry.get(&id)?;
    git::impact(&session.git, &oid).await
}

#[tauri::command]
pub async fn reset_to(
    registry: State<'_, RepoRegistry>,
    id: String,
    oid: String,
    mode: git::ResetMode,
) -> Result<String> {
    let session = registry.get(&id)?;
    git::reset(&session.git, &oid, mode).await
}

#[tauri::command]
pub async fn revert_commit(
    registry: State<'_, RepoRegistry>,
    id: String,
    oid: String,
) -> Result<String> {
    let session = registry.get(&id)?;
    git::revert(&session.git, &oid).await
}

/// The terminals this platform can offer, for the settings picker.
#[tauri::command]
pub fn terminal_options() -> Vec<system::TerminalOption> {
    system::terminal_options()
}

// --- diagnostics ----------------------------------------------------------

/// Surface whether git's filesystem monitor is actually running for a repo.
///
/// Worth showing in the UI: it is the difference between a status refresh that
/// walks `node_modules` and one that does not, and it silently fails to start
/// on some configurations.
#[tauri::command]
pub async fn fsmonitor_state(registry: State<'_, RepoRegistry>, id: String) -> Result<String> {
    let session = registry.get(&id)?;

    match session.git.run_str(&["fsmonitor--daemon", "status"]).await {
        Ok(out) => Ok(out),
        Err(AppError::Git { stderr, .. }) => Ok(stderr),
        Err(e) => Err(e),
    }
}

// --- helpers --------------------------------------------------------------

/// Append `-- <paths>` to a git invocation.
///
/// The `--` separator is not optional: without it a branch and a file with the
/// same name are ambiguous, and git may act on the wrong one.
async fn run_with_paths(git: &Git, base: &[&str], paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }

    let mut args: Vec<&str> = base.to_vec();
    args.push("--");
    args.extend(paths.iter().map(String::as_str));

    git.run(&args).await?;
    Ok(())
}
