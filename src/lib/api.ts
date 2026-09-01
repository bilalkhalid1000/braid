import { invoke } from "@tauri-apps/api/core";

import type { Bookmark } from "./library";
import { listen } from "@tauri-apps/api/event";

// --- status ---------------------------------------------------------------

export type EntryKind =
  | "ordinary"
  | "renamed"
  | "unmerged"
  | "untracked"
  | "ignored";

export interface StatusEntry {
  path: string;
  origPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  kind: EntryKind;
}

/** An operation git has started and not finished. A failed pull can leave the
 *  repository mid-merge, and until that is resolved most commands refuse. */
export type RepoState =
  | "clean"
  | "merging"
  | "rebasing"
  | "cherryPicking"
  | "reverting"
  | "bisecting";

export const operationLabel: Record<Exclude<RepoState, "clean">, string> = {
  merging: "Merge in progress",
  rebasing: "Rebase in progress",
  cherryPicking: "Cherry-pick in progress",
  reverting: "Revert in progress",
  bisecting: "Bisect in progress",
};

export interface RepoStatus {
  head: string | null;
  headOid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: StatusEntry[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  state: RepoState;
  /** Time the backing git call took. Rendered in the status bar so a
   *  performance regression is visible during development, not just felt. */
  durationMs: number;
}

// --- diff -----------------------------------------------------------------

export type DiffTarget = "staged" | "worktree" | "untracked";

export interface DiffLine {
  kind: "context" | "added" | "removed" | "meta";
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export type HunkAction = "stage" | "unstage" | "discard";

export interface FileDiff {
  path: string;
  /** The lines git printed before the first hunk, kept so a patch built from
   *  one hunk carries the header git would have written. */
  header: string;
  binary: boolean;
  truncated: boolean;
  hunks: DiffHunk[];
  added: number;
  removed: number;
  durationMs: number;
}

// --- refs -----------------------------------------------------------------

export interface BranchRef {
  name: string;
  isHead: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  oid: string;
}

export interface RemoteGroup {
  name: string;
  branches: string[];
}

export interface StashEntry {
  selector: string;
  message: string;
}

export interface RefsSnapshot {
  branches: BranchRef[];
  remotes: RemoteGroup[];
  tags: string[];
  stashes: StashEntry[];
}

// --- log ------------------------------------------------------------------

export interface Commit {
  oid: string;
  short: string;
  author: string;
  email: string;
  timestamp: number;
  parents: string[];
  refs: string[];
  subject: string;
}

export interface FileStat {
  path: string;
  /** Present when the file was renamed or copied. */
  oldPath: string | null;
  additions: number;
  deletions: number;
  /** Git reports no line counts for a binary file, only that it changed. */
  binary: boolean;
}

export interface CommitDetail {
  oid: string;
  short: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  body: string;
  parents: string[];
  files: FileStat[];
  additions: number;
  deletions: number;
  durationMs: number;
}

export interface LogPage {
  commits: Commit[];
  hasMore: boolean;
  durationMs: number;
}

// --- worktrees and submodules ---------------------------------------------

export interface Worktree {
  path: string;
  head: string | null;
  branch: string | null;
  isBare: boolean;
  isDetached: boolean;
  isLocked: boolean;
  lockReason: string | null;
  prunable: boolean;
  isMain: boolean;
}

export type SubmoduleState = "uninitialized" | "upToDate" | "modified" | "conflicted";

export interface Submodule {
  path: string;
  oid: string;
  describe: string | null;
  state: SubmoduleState;
  url: string | null;
}

// --- git flow -------------------------------------------------------------

export type FlowKind = "feature" | "bugfix" | "release" | "hotfix" | "support";

export interface FlowConfig {
  master: string;
  develop: string;
  feature: string;
  bugfix: string;
  release: string;
  hotfix: string;
  support: string;
  versiontag: string;
}

export interface CurrentFlow {
  kind: FlowKind;
  /** The part after the prefix: "login" for "feature/login". */
  name: string;
  branch: string;
}

/** Line-by-line authorship. Commits are keyed separately from lines because a
 *  long file is the work of a few dozen commits, and repeating the author and
 *  summary on every line would cost more to send than the blame does to
 *  compute. */
/** Pushed while a clone runs. `percent` is absent for phases git counts but
 *  cannot total, like enumerating objects. */
export interface CloneProgress {
  phase: string;
  percent: number | null;
}

export const CLONE_PROGRESS_EVENT = "clone://progress";

/** One git process. Arrives twice: once as it starts, once as it ends. */
export interface GitCommand {
  id: number;
  /** Arguments without the leading `git`. */
  args: string[];
  /** Null while it is still running. */
  durationMs: number | null;
  code: number | null;
}

export const GIT_COMMAND_EVENT = "git://command";

// --- search ---------------------------------------------------------------

export type SearchKind = "commits" | "code" | "files";

export interface CodeHit {
  path: string;
  line: number;
  text: string;
}

export interface SearchResults {
  commits: Commit[];
  code: CodeHit[];
  files: string[];
  /** A list was cut at the limit, so the view can say so rather than implying
   *  that is all there is. */
  truncated: boolean;
  durationMs: number;
}

export interface BlameCommit {
  oid: string;
  author: string;
  authorMail: string;
  /** Seconds since the epoch. */
  authorTime: number;
  summary: string;
  /** The line is edited but not committed, so there is no author yet. */
  uncommitted: boolean;
}

export interface BlameLine {
  oid: string;
  line: number;
  originalLine: number;
  content: string;
}

export interface Blame {
  path: string;
  lines: BlameLine[];
  commits: Record<string, BlameCommit>;
  tookMs: number;
}

/** A file to blame, and the revision to blame it at — null for the working
 *  tree, which is the usual case: you read the file you are editing. */
export interface BlameTarget {
  path: string;
  rev: string | null;
}

export interface FlowStatus {
  initialized: boolean;
  config: FlowConfig;
  current: CurrentFlow | null;
  developExists: boolean;
  masterExists: boolean;
}

export interface FlowFinishOptions {
  deleteBranch: boolean;
  /** Delete even where git says the branch is not fully merged. */
  forceDelete: boolean;
  push: boolean;
  /** Whether to tag at all. Release and hotfix only; ignored for a feature,
   *  which git flow never tags. */
  tag: boolean;
  tagMessage: string;
}

/** Releases and hotfixes land on the production branch and get a tag; the
 *  others only ever touch develop. */
export const isReleaseKind = (kind: FlowKind) => kind === "release" || kind === "hotfix";

export const flowNoun: Record<FlowKind, string> = {
  feature: "feature",
  bugfix: "bugfix",
  release: "release",
  hotfix: "hotfix",
  support: "support branch",
};

/** A terminal offered in settings. The backend names them, because it is what
 *  knows how to start them. */
export interface TerminalOption {
  id: string;
  label: string;
}

/** Which refs the history walks. Named the way the control names them, so the
 *  stored value reads as what the user chose. */
export type HistoryScope = "all" | "local" | "head";

/** How much of the branch a reset would move past. */
export type ResetMode = "soft" | "mixed" | "hard";

export interface ResetImpact {
  /** Commits the branch would stop pointing at. */
  dropped: number;
  upstream: string | null;
  /** How many of the dropped commits the upstream already has. Non-zero means
   *  the history is published. */
  published: number;
}

export interface Session {
  /** Worktree roots, in tab order. */
  repos: string[];
  active: string | null;
}

export interface RepoInfo {
  id: string;
  name: string;
  root: string;
}

export const api = {
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  initRepo: (path: string, initialBranch: string) =>
    invoke<RepoInfo>("init_repo", { path, initialBranch }),
  closeRepo: (id: string) => invoke<void>("close_repo", { id }),
  listRepos: () => invoke<RepoInfo[]>("list_repos"),

  loadSession: () => invoke<Session>("load_session"),
  loadSettings: () => invoke<Record<string, unknown>>("load_settings"),
  saveSettings: (settings: unknown) => invoke<void>("save_settings", { settings }),
  saveSession: (session: Session) => invoke<void>("save_session", { session }),

  repoStatus: (id: string) => invoke<RepoStatus>("repo_status", { id }),
  repoRefs: (id: string) => invoke<RefsSnapshot>("repo_refs", { id }),
  resetImpact: (id: string, oid: string) => invoke<ResetImpact>("reset_impact", { id, oid }),
  resetTo: (id: string, oid: string, mode: ResetMode) =>
    invoke<string>("reset_to", { id, oid, mode }),
  revertCommit: (id: string, oid: string) => invoke<string>("revert_commit", { id, oid }),
  dropImpact: (id: string, oid: string) => invoke<ResetImpact>("drop_impact", { id, oid }),
  dropCommit: (id: string, oid: string) => invoke<string>("drop_commit", { id, oid }),
  repoLog: (id: string, skip: number, limit: number, scope: HistoryScope) =>
    invoke<LogPage>("repo_log", { id, skip, limit, scope }),
  applyHunk: (
    id: string,
    request: {
      path: string;
      hunkIndex: number;
      /** Indices within the hunk, or omitted for all of it. */
      lines?: number[];
      mode: HunkAction;
      contextLines: number;
      ignoreWhitespace: boolean;
    },
  ) => invoke<string>("apply_hunk", { id, request: { ...request, lines: request.lines ?? null } }),

  fileDiff: (
    id: string,
    path: string,
    target: DiffTarget,
    contextLines: number,
    ignoreWhitespace: boolean,
  ) => invoke<FileDiff>("file_diff", { id, path, target, contextLines, ignoreWhitespace }),
  deleteRemoteBranch: (id: string, remote: string, branch: string) =>
    invoke<string>("delete_remote_branch", { id, remote, branch }),
  publishBranch: (id: string, branch: string, remote: string | null) =>
    invoke<string>("publish_branch", { id, branch, remote }),
  loadLibrary: () => invoke<{ repos: Bookmark[] }>("load_library"),
  saveLibrary: (repos: Bookmark[]) => invoke<void>("save_library", { library: { repos } }),
  cloneRepo: (url: string, path: string) =>
    invoke<RepoInfo>("clone_repo", { url, path }),
  search: (id: string, query: string, kind: SearchKind) =>
    invoke<SearchResults>("search_repo", { id, query, kind }),
  blame: (id: string, path: string, rev: string | null) =>
    invoke<Blame>("blame_file", { id, path, rev }),
  commitDetail: (id: string, oid: string) =>
    invoke<CommitDetail>("commit_detail", { id, oid }),
  commitFileDiff: (
    id: string,
    oid: string,
    path: string,
    contextLines: number,
    ignoreWhitespace: boolean,
  ) =>
    invoke<FileDiff>("commit_file_diff", {
      id,
      oid,
      path,
      contextLines,
      ignoreWhitespace,
    }),

  stage: (id: string, paths: string[]) => invoke<void>("stage_paths", { id, paths }),
  unstage: (id: string, paths: string[]) => invoke<void>("unstage_paths", { id, paths }),
  discard: (id: string, paths: string[]) => invoke<void>("discard_paths", { id, paths }),
  commit: (id: string, message: string, amend: boolean) =>
    invoke<string>("commit", { id, message, amend }),

  fetch: (id: string) => invoke<string>("fetch", { id }),
  pull: (id: string) => invoke<string>("pull", { id }),
  push: (id: string) => invoke<string>("push", { id }),

  checkout: (id: string, name: string) => invoke<string>("checkout", { id, name }),
  createBranch: (
    id: string,
    name: string,
    checkoutAfter: boolean,
    base: string | null,
  ) => invoke<string>("create_branch", { id, name, checkoutAfter, base }),
  deleteBranch: (id: string, name: string, force: boolean) =>
    invoke<string>("delete_branch", { id, name, force }),
  mergeBranch: (id: string, name: string) => invoke<string>("merge_branch", { id, name }),

  stashPush: (id: string, message: string, includeUntracked: boolean) =>
    invoke<string>("stash_push", { id, message, includeUntracked }),
  stashApply: (id: string, selector: string, pop: boolean) =>
    invoke<string>("stash_apply", { id, selector, pop }),
  stashDrop: (id: string, selector: string) => invoke<string>("stash_drop", { id, selector }),

  listWorktrees: (id: string) => invoke<Worktree[]>("list_worktrees", { id }),
  addWorktree: (id: string, path: string, branch: string, newBranch: boolean) =>
    invoke<string>("add_worktree", { id, path, branch, newBranch }),
  removeWorktree: (id: string, path: string, force: boolean) =>
    invoke<string>("remove_worktree", { id, path, force }),
  pruneWorktrees: (id: string) => invoke<string>("prune_worktrees", { id }),

  listSubmodules: (id: string) => invoke<Submodule[]>("list_submodules", { id }),
  updateSubmodules: (id: string, path: string, recursive: boolean) =>
    invoke<string>("update_submodules", { id, path, recursive }),
  syncSubmodules: (id: string, recursive: boolean) =>
    invoke<string>("sync_submodules", { id, recursive }),

  flowStatus: (id: string) => invoke<FlowStatus>("flow_status", { id }),
  flowInit: (id: string, config: FlowConfig) => invoke<string>("flow_init", { id, config }),
  flowStart: (id: string, kind: FlowKind, name: string) =>
    invoke<string>("flow_start", { id, kind, name }),
  flowFinish: (id: string, kind: FlowKind, name: string, options: FlowFinishOptions) =>
    invoke<string>("flow_finish", { id, kind, name, options }),

  resolveWithSide: (id: string, path: string, side: "ours" | "theirs") =>
    invoke<string>("resolve_with_side", { id, path, side }),
  markResolved: (id: string, path: string) =>
    invoke<string>("mark_resolved", { id, path }),

  abortOperation: (id: string) => invoke<string>("abort_operation", { id }),
  continueOperation: (id: string) => invoke<string>("continue_operation", { id }),
  skipOperation: (id: string) => invoke<string>("skip_operation", { id }),

  openInFileManager: (id: string) => invoke<string>("open_in_file_manager", { id }),
  openInTerminal: (id: string, terminal: string, command: string) =>
    invoke<string>("open_in_terminal", { id, terminal, command }),
  /** What this platform can offer in the terminal picker. Asked of the
   *  backend rather than listed here, so the choices and the launcher cannot
   *  disagree about what exists. */
  terminalOptions: () => invoke<TerminalOption[]>("terminal_options"),

  fsmonitorState: (id: string) => invoke<string>("fsmonitor_state", { id }),
};

export const submoduleLabel: Record<SubmoduleState, string> = {
  uninitialized: "Not initialized",
  upToDate: "Up to date",
  modified: "Different commit checked out",
  conflicted: "Conflicted",
};

/** Fires as each git process starts and again as it ends. */
export const onGitCommand = (cb: (command: GitCommand) => void) =>
  listen<GitCommand>(GIT_COMMAND_EVENT, (event) => cb(event.payload));

/** Fires while a clone runs, many times a second on a large repository. */
export const onCloneProgress = (cb: (progress: CloneProgress) => void) =>
  listen<CloneProgress>(CLONE_PROGRESS_EVENT, (event) => cb(event.payload));

/** Fires when a repo's on-disk state changed. Payload is the repo id. */
export const onRepoChanged = (cb: (id: string) => void) =>
  listen<string>("repo://changed", (event) => cb(event.payload));

export const isStaged = (e: StatusEntry) =>
  e.indexStatus !== "." && e.kind !== "untracked";

export const isUnstaged = (e: StatusEntry) =>
  e.worktreeStatus !== "." || e.kind === "untracked";

/** Single-letter badge for a row, matching git's own vocabulary. */
export const badgeFor = (e: StatusEntry, staged: boolean) => {
  if (e.kind === "unmerged") return "!";
  if (e.kind === "untracked") return "?";
  return staged ? e.indexStatus : e.worktreeStatus;
};

export const diffTargetFor = (e: StatusEntry, staged: boolean): DiffTarget =>
  staged ? "staged" : e.kind === "untracked" ? "untracked" : "worktree";
