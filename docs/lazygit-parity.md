# Braid and lazygit: feature parity report

Written 2026-09-05 against Braid 0.1.0-alpha.7 and the current lazygit keybinding
reference (`docs/keybindings/Keybindings_en.md`) and README on master.

Sources for Braid's side: the Tauri command list in `src-tauri/src/ipc.rs`, the
command table in `src/lib/commands.ts`, the context menus and dialogs in
`src/App.tsx`, and `PLAN.md` section 4.

Parity here means "the same git operation is reachable from the UI", not
"the same keys". Where Braid does something lazygit does not, it is noted at
the end so the gap list is not read as a one-way deficit.

## 1. What Braid has today

| Area | Braid offers |
| --- | --- |
| Repositories | Open, create, clone, rename, close; tabs with reordering; repository library with last session; open in file manager, terminal, editor |
| Working copy | Live status from filesystem events; stage, unstage, discard by file, by hunk, and by line; stage all, unstage all, discard all; commit with amend |
| Diff | Unified, virtualized; context line count and whitespace toggle in settings; binary and oversize handling; blame per file |
| History | Paged, virtualized graph; scope all, local, or current branch; commit detail with per-file diffs; copy hash; revert; drop; reset soft, mixed, hard to a commit; jump from search or a branch click |
| Search | Commits, code, and file paths |
| Branches | List with upstream, ahead and behind; checkout; new branch from any ref with optional checkout; delete local, remote, or both, with force; merge; publish to a chosen remote |
| Remote branches | Checkout, merge, delete |
| Tags | List, checkout detached, merge |
| Stash | Push with message and untracked option; apply; pop; drop |
| Sync | Fetch, pull, push, with no options |
| Worktrees | List, add with branch, remove with force, prune, open as its own tab |
| Submodules | List with state, update, sync, open as its own tab |
| Git flow | Init with prefixes, start feature, bugfix, release, hotfix; finish with tag, delete, push options |
| Conflicts and operations | Banner for merge, rebase, cherry-pick in progress with abort, continue, skip; take ours or theirs per file; mark resolved |
| Shell | Command palette, editable keymap with sequences, activity log with git output, themes, auto-update |

## 2. What lazygit has that Braid does not

Grouped by lazygit panel. Each item says what the operation is and how much of
it Braid's backend already has. "CLI only" means one new Tauri command that
shells out and a menu entry; "new UI" means a view or interaction that does
not exist yet.

### 2.1 Remotes

Braid has no remotes panel beyond listing remote branches. The remote itself
cannot be touched from the UI.

| lazygit | Braid | Cost |
| --- | --- | --- |
| New remote (name, URL) | Missing | CLI only: `git remote add` |
| Edit remote (rename, change URL) | Missing | CLI only: `git remote rename`, `git remote set-url` |
| Remove remote | Missing | CLI only: `git remote remove` |
| Fetch one remote | Fetch is all-remotes only | CLI only: `git fetch <name>` |
| Add fork remote (from a GitHub URL) | Missing | CLI only, plus a small URL prompt |
| Set as upstream (from a remote branch) | Only via publish | CLI only: `git branch --set-upstream-to` |
| Unset upstream, view upstream options | Missing | CLI only |
| Fetch with prune | Missing | Option on fetch |

### 2.2 Commits

This is the largest gap. Braid's commit menu has copy hash, revert, drop, and
reset. lazygit's has around thirty entries.

| lazygit | Braid | Cost |
| --- | --- | --- |
| Interactive rebase: squash, fixup, reword, edit, drop, pick, move up and down, start rebase at a commit | Only drop | New UI. `PLAN.md` v2 lists this as a drag-and-drop editor. Drop already uses the same `GIT_SEQUENCE_EDITOR` mechanism, so the backend has the seed of it |
| Reword commit, with editor or in-app | Missing | CLI only for HEAD via `commit --amend`; older commits need the rebase mechanism above |
| Amend older commit with staged changes | Amend is HEAD only | Rebase mechanism |
| Create fixup commit, apply fixups (autosquash) | Missing | CLI only: `commit --fixup`, `rebase -i --autosquash` |
| Cherry-pick (copy and paste one or a range) | Missing. Backend already handles a cherry-pick in progress | CLI only: `git cherry-pick` |
| Checkout commit (detached) | Missing | CLI only: existing checkout command takes any ref |
| New branch from commit | Missing. New-branch dialog accepts a base ref, but the commit menu does not offer it | Menu entry only |
| Tag commit | Missing | CLI only: `git tag` |
| Reset to commit | Present | |
| Revert | Present | |
| Bisect (mark good, bad, skip; reset) | Missing | CLI only for commands; new UI for state in the history |
| Mark base commit for rebase, rebase from there | Missing | Rebase mechanism |
| Move commits to a new branch | Missing | CLI: new branch at HEAD, reset current back |
| Copy commit attributes (author, subject, body, URL) | Only hash | Menu entries |
| Open commit or pull request in browser | Missing | Needs remote URL parsing |
| Compare two commits, diff against a ref | Missing | New UI |
| Range select (act on several commits) | Missing | New UI |
| Select commits of current branch | Missing | UI only |
| Custom patch building: pick lines out of old commits, remove from commit, move to index or a new commit | Missing | Rebase mechanism plus a line-picking view. Braid already has line picking for staging |
| Amend commit attribute (author, co-author) | Missing | CLI only |

### 2.3 Commit files (the files of a selected commit)

| lazygit | Braid | Cost |
| --- | --- | --- |
| Checkout the file from that commit | Missing | CLI only: `git checkout <sha> -- path` |
| Discard the commit's changes to a file | Missing | Rebase mechanism |
| Open or edit file | Missing | Editor command exists at repo level; needs a path argument |
| Copy path, copy contents | Missing | Menu entries |
| Tree view, collapse and expand | Flat list | New UI |
| External diff tool | Missing | CLI only: `git difftool` |

### 2.4 Files (working copy)

| lazygit | Braid | Cost |
| --- | --- | --- |
| Ignore or exclude a file | Missing | Append to `.gitignore` or `.git/info/exclude` |
| Open or edit file in editor | Repo-level only | Editor command with path |
| Copy path, copy contents | Missing | Menu entries |
| Commit without pre-commit hook | Missing | Flag on commit |
| Commit using git's editor | Missing | CLI only, needs a terminal-capable editor |
| Amend last commit from the file list | Present in commit box | |
| Find base commit for fixup | Missing | Uses `git blame` on the hunks |
| Reset options: soft, mixed, hard to upstream; nuke working tree including untracked | Discard all only | CLI only: `git reset`, `git clean -fd` |
| Stash options: all, staged only, unstaged only, keep index, include untracked | Message and untracked only | Flags on stash push |
| Filter files by status | Missing | UI only |
| Tree view toggle, collapse, expand | Flat list | New UI |
| Range select for staging several files | Missing | New UI |
| Edit hunk in editor | Missing | Editor with line number |
| Stage lines, hunks, ranges | Present | |
| External diff tool | Missing | CLI only |

### 2.5 Local branches

| lazygit | Braid | Cost |
| --- | --- | --- |
| Rebase onto branch | Missing, though `PLAN.md` v1 lists it and the backend already handles a rebase in progress | CLI only: `git rebase <branch>` |
| Rename branch | Missing | CLI only: `git branch -m` |
| Force checkout (discard local changes) | Missing | Flag on checkout |
| Checkout by name or any ref | Only listed refs | Prompt plus existing checkout |
| Checkout previous branch | Missing | CLI only: `git checkout -` |
| Fast-forward a branch without checking it out | Missing | CLI only: `git fetch <remote> <branch>:<branch>` |
| New tag on branch | Missing | CLI only |
| Sort order (recency, alphabetical, date) | Fixed by commit date | UI only |
| Reset current branch to another branch | Only from history menu | Menu entry |
| Create pull request, open pull request, copy URL; PR status icons | Missing | Needs hosting-provider URL templates |
| View upstream options: set, unset, view divergence | Only publish | CLI only |
| New worktree from branch | Present via worktree dialog | |
| View commits of the branch | Only via history scope, not per branch | Filter on the log command |
| Move commits to new branch | Missing | See commits |

### 2.6 Remote branches

| lazygit | Braid | Cost |
| --- | --- | --- |
| New local branch from remote branch | Only via new-branch dialog base field | Menu entry |
| Rebase onto remote branch | Missing | CLI only |
| Set as upstream | Missing | CLI only |
| Reset to remote branch | Missing | Menu entry |
| Sort order | Missing | UI only |
| Checkout, merge, delete | Present | |

### 2.7 Tags

| lazygit | Braid | Cost |
| --- | --- | --- |
| Create tag, lightweight or annotated | Only inside git flow finish | CLI only: `git tag`, `git tag -a` |
| Delete tag | Refused with "not supported yet" | CLI only: `git tag -d`, optionally `git push --delete` |
| Push tag | Missing | CLI only |
| New branch or worktree from tag | Missing | Menu entries into existing dialogs |
| Reset to tag | Missing | Menu entry |

### 2.8 Stash

| lazygit | Braid | Cost |
| --- | --- | --- |
| Show a stash's files and diff | Missing | Reuse commit detail with `stash@{n}` |
| New branch from stash | Missing | CLI only: `git stash branch` |
| Rename stash | Missing | CLI: drop and re-store with `git stash store` |
| New worktree from stash | Missing | Rare; skip |

### 2.9 Reflog, undo, redo

| lazygit | Braid | Cost |
| --- | --- | --- |
| Reflog panel: browse, checkout, reset, cherry-pick, new branch from an entry | Missing | New panel over `git reflog` |
| Undo and redo of the last action via reflog | Missing. `PLAN.md` v2 lists a visible undo stack | New UI and careful backend |

### 2.10 Merge conflicts

| lazygit | Braid | Cost |
| --- | --- | --- |
| Per-conflict hunk picking: ours, theirs, both; next and previous conflict; undo | Whole-file ours or theirs only | New UI. `PLAN.md` v2 lists a three-way merge view |
| Edit conflicted file in editor | Missing | Editor with path |
| Abort, continue, skip | Present | |

### 2.11 Sync options

| lazygit | Braid | Cost |
| --- | --- | --- |
| Pull with rebase, pull from a chosen remote or branch | Plain pull | Flags |
| Push with force-with-lease, push to a chosen remote or branch, push tags | Plain push | Flags |
| Fetch one remote, fetch with prune | Fetch all | Flags |

### 2.12 Submodules and worktrees

| lazygit | Braid | Cost |
| --- | --- | --- |
| Add submodule, remove submodule, update URL, init | Update and sync only | CLI only |
| Bulk options: init all, update all, deinit all | Update all present | Menu entries |
| Worktree: open in editor | Open as tab present | Editor with path |

### 2.13 Global and configuration

| lazygit | Braid | Cost |
| --- | --- | --- |
| Custom commands: user-defined git commands with prompts, bound to keys, per context | Missing. `PLAN.md` v2 lists it | New config schema and UI |
| Execute an arbitrary shell command | Missing | Prompt plus the existing system command runner |
| Diff context size and whitespace toggles on a key | In settings only | Bind existing settings to commands |
| Rename similarity threshold | Missing | Flag on diff |
| External diff tool | Missing | CLI only |
| Log options: show graph, topo or date order, show all or current branch | Scope only | Flags on log |
| Diffing mode: diff any two refs in the main view | Missing | New UI |
| Filter commits by path or author | Search only | Flag on log |
| Search inside the diff pane | Missing | UI only |
| Screen modes (half, full) | Fixed layout with splitters | Not needed in a GUI |
| Suspend, edit config file | Not applicable | |
| Recent repositories, check for update, command log, keybinding help | Present | |

## 3. What Braid has that lazygit does not

- Several repositories open at once as tabs, each independently live.
- Filesystem-event status with no polling, and a repository library with
  session restore.
- Search across commits, code, and paths in one place.
- Git flow with a guided setup and finish dialog. lazygit shells out to the
  git-flow binary and only when it is installed.
- Blame as a view with commit navigation.
- Worktrees and submodules opened as their own tabs.
- Native file manager, terminal, and editor integration with configurable
  commands.
- Themes, auto-update, and a GUI keymap editor with key sequences.

## 4. Suggested order

Ordered by daily value against implementation cost. The first tier is almost
entirely "one Tauri command that shells out, plus a menu entry or dialog",
which is the shape of most of Braid's existing operations.

### Tier 1: cheap and used every day

1. **Remotes panel actions**: add, rename, change URL, remove, fetch one. The
   sidebar already has a remotes section to hang the menu on.
2. **Rebase onto a branch**, with pull with rebase. The in-progress banner,
   conflict bar, abort, continue, and skip already exist, so only the starting
   command is missing.
3. **Push and fetch options**: force with lease, push tags, fetch with prune,
   choose remote.
4. **Tags**: create lightweight or annotated, delete, push. Delete is already
   wired to a refusal message.
5. **Cherry-pick** one commit from the history menu. The in-progress handling
   already exists.
6. **Commit menu additions**: checkout commit, new branch from commit, tag
   commit, copy author, subject, and body.
7. **Branch rename, set and unset upstream, force checkout, checkout by name.**
8. **Ignore file, open file in editor, copy path** on working-copy and commit
   files.
9. **Commit without hooks** as a checkbox on the commit box.
10. **Stash options** (staged only, keep index) and **stash diff** in the
    detail pane.

### Tier 2: real features, planned in `PLAN.md` v2

1. **Interactive rebase editor**: reorder, squash, fixup, reword, edit, drop.
   Unlocks amend older commit, autosquash, custom patches, and discard a
   commit's change to a file.
2. **Reflog panel and undo**.
3. **Conflict resolver** with hunk-level picking.
4. **Custom commands** with prompts and key bindings.
5. **Bisect** with good, bad, skip state shown in the history.

### Tier 3: nice to have

1. Pull request creation and opening, PR status in the branch list.
2. Compare two commits, diff any two refs.
3. File tree view with collapse and expand, filter by status, range select.
4. Branch sort orders and log ordering options.
5. External difftool.

## 5. Counting it

Approximate, by lazygit menu entries that map to a distinct git operation.

| Area | lazygit operations | Braid has | Missing |
| --- | --- | --- | --- |
| Remotes | 7 | 0 | 7 |
| Commits | 30 | 5 | 25 |
| Commit files | 6 | 1 | 5 |
| Files | 18 | 8 | 10 |
| Local branches | 20 | 6 | 14 |
| Remote branches | 8 | 3 | 5 |
| Tags | 7 | 2 | 5 |
| Stash | 6 | 3 | 3 |
| Reflog and undo | 6 | 0 | 6 |
| Conflicts | 8 | 3 | 5 |
| Sync options | 7 | 3 | 4 |
| Submodules and worktrees | 11 | 6 | 5 |
| Global | 12 | 5 | 7 |
| **Total** | **146** | **45** | **101** |

Roughly a third of lazygit's operation surface is covered today. About sixty
of the missing hundred are Tier 1 shape: a git command Braid does not yet
issue, reachable through a menu or dialog Braid already has.

## 6. Tier 1 implementation plan

Implemented 2026-09-05. Every item below is in the app; the keys are `O` to
check out by name, `T` for a new tag, `R` to add a remote, and `G P`,
`G Shift+P`, `G T` for pull with rebase, force push, and push tags.

Each step is one backend command or flag, its API wrapper, and the menu or
dialog that reaches it. Rust tests cover anything with parsing or file
writing; one-line git invocations are not unit-tested, which matches the rest
of the backend.

1. **Remotes.** The refs snapshot lists every remote with its URL, including
   one with no branches yet. Sidebar: "Add remote" on the Remotes heading; a
   right-click menu on each remote with Fetch, Edit (name and URL), Remove.
2. **Rebase and sync options.** Branch menu gains "Rebase onto". Pull button
   right-click offers pull with rebase; Push button right-click offers force
   with lease and push tags. Same entries in the palette.
3. **Tags.** "New tag" on the Tags heading, annotated when a message is
   given, at any ref. Tag menu gains push, delete (optionally on a remote),
   and new branch from tag.
4. **Commit menu.** Cherry-pick, check out detached, new branch from here,
   tag this commit, copy author and subject.
5. **Branch menu.** Rename, set or unset upstream, check out discarding local
   changes. Palette: check out by name.
6. **Files.** Working-copy and commit file menus gain open in editor and copy
   path; working-copy files also gain add to .gitignore and exclude locally.
7. **Commit box.** "Skip hooks" checkbox.
8. **Stash.** Push dialog gains staged-only and keep-index. Clicking a stash
   shows its files and diff in the main panel.
