# Braid — a fast, keyboard-first Git GUI

> Named for braided rivers, which split into channels and rejoin downstream. That
> is a commit graph, and it is what the app draws and what the icon shows.

## 1. Why

SourceTree degrades badly with several repos open. Measured causes on this machine
(Windows 10, NTFS, git 2.55, repos are React/Flutter/Laravel with large `node_modules`):

| Cause | Effect |
| --- | --- |
| Polls `git status` on a timer, per open tab | N repos = N full worktree walks, forever |
| Walks `node_modules` / `build` / `vendor` on every status | The dominant cost. NTFS stat calls are slow |
| Parses full `git log` text output, builds a UI row per commit | Linear memory + layout cost in repo size |
| No list virtualization | 50k commits = 50k live UI elements |
| One `git.exe` spawn per operation, per tab | Process-spawn overhead dominates on Windows |
| .NET/WPF + COM marshalling | Fixed overhead on top of all of the above |

lazygit is fast because it does the opposite of most of that, but it is a TUI.
Goal: lazygit's model and speed, in a real GUI.

## 2. Non-negotiable performance rules

These are the design, not optimizations to add later. Every feature must obey them.

1. **Never poll.** Repo state refreshes come from `git fsmonitor--daemon` plus a native
   filesystem watcher, debounced. Idle repos cost zero CPU.
2. **Never re-parse the full log.** Topology comes from git's `commit-graph` file, which we
   maintain in the background. Commits load in windows (~500) as the viewport moves.
3. **Virtualize every list.** Commits, files, branches, stashes, reflog. Render only what is
   on screen, regardless of collection size.
4. **One backend, N repos.** A single process with a shared thread pool. Opening the 5th
   repo costs a tab, not a runtime.
5. **Diffs strictly on demand.** No diff is computed for a row that is not visible. Large
   diffs stream in chunks; binary and generated files are detected and skipped.
6. **Never block the UI thread.** Every git call is async with a cancellation token. Moving
   the selection cancels the in-flight request for the old selection.
7. **Budget: interaction to first paint under 16ms; any git operation under 100ms or it
   shows progress and stays cancellable.**

## 3. Architecture

```
+------------------- WebView (React + TypeScript) --------------------+
|  Virtualized views - command palette - keymap - diff renderer       |
|  State: TanStack Query over Tauri IPC. No git logic lives here.     |
+-------------------------------^-------------------------------------+
                                | Tauri IPC (commands + events)
+-------------------------------v-------------------------------------+
|                        Rust backend (one process)                    |
|                                                                      |
|  RepoRegistry -- owns N RepoSession, one per open tab                |
|      |                                                               |
|      +-- StatusEngine    fsmonitor + notify watcher -> debounce      |
|      +-- GraphEngine     commit-graph -> lane layout, incremental    |
|      +-- DiffEngine      on-demand, chunked, cancellable             |
|      +-- OpsEngine       commit/stage/branch/rebase/push/pull        |
|      +-- Cache           SQLite: graph layout, per-repo UI state     |
|                                                                      |
|  Shared rayon thread pool. Every engine is cancellable.              |
+----------------------------------------------------------------------+
                                |
              gitoxide (`gix`) for reads - `git` CLI for writes
```

### Why gitoxide for reads, CLI for writes

`gix` is dramatically faster than shelling out for log traversal, status, and diff, and it
lets us hold an open object database across calls instead of paying process startup per
operation. But it does not yet cover every write path, and reimplementing `push`, `rebase
--interactive`, or credential/SSH handling is a liability, not a feature.

So: **reads go through `gix`, writes shell out to the user's own `git`.** This also means
hooks, credential helpers, GPG signing, LFS, and `.gitconfig` all behave exactly as they do
in the terminal — which is the single most common way GUIs surprise people.

### Cancellation

Every IPC command carries a request id. Selecting a different commit fires a cancel for the
previous one. Without this, fast arrow-key scrolling through history queues hundreds of
diffs and the app feels exactly like SourceTree.

## 4. Feature scope

### v1 (agreed MVP)
- **Working copy**: status tree, stage/unstage by file, hunk, and individual line, discard
  with confirmation, commit box with amend and message history.
- **History**: virtualized commit graph with branch lanes, commit detail, side-by-side and
  unified diff, file history, blame.
- **Branches/remotes**: branch list with ahead/behind, checkout, create, delete, merge,
  rebase, background auto-fetch, stash push/pop/apply, tags.
- **Multi-repo**: tabs, each independently live, no cross-repo slowdown. Recent-repos list.
- **Keyboard**: `Ctrl+P` command palette over every action, full keyboard navigation, an
  editable keymap. Nothing requires the mouse.

### v2 (the "better than lazygit" layer)
- Interactive rebase as a drag-and-drop editor (reorder, squash, fixup, edit, drop) with a
  live preview of the resulting history.
- Reflog-backed undo for anything destructive, surfaced as a visible undo stack.
- Conflict resolver with a real three-way merge view.
- Custom commands: user-defined git scripts bound to keys, like lazygit's.
- Worktrees and submodules as first-class UI.
- Partial/sparse clone support for genuinely large repos.

### Explicitly out of scope
Bundled diff/merge tools (delegate to the user's configured one), issue trackers, CI panels,
accounts. Those are why the other GUIs are slow.

## 5. Build phases

| Phase | Deliverable | Exit criteria |
| --- | --- | --- |
| 0 | Toolchain + Tauri scaffold, empty window | `pnpm tauri dev` opens a window |
| 1 | Repo open, status engine, virtualized file tree | Status refresh on file change under 50ms on a repo with `node_modules` |
| 2 | Stage/unstage/discard at file, hunk, line; commit | Full commit loop usable daily |
| 3 | Graph engine + virtualized history + diff viewer | 50k-commit repo scrolls at 60fps, opens under 300ms |
| 4 | Branches, remotes, fetch/push/pull, stash, tags | Feature parity with SourceTree's daily surface |
| 5 | Multi-repo tabs, command palette, keymap | 5 repos open, idle CPU ~0%, RAM under 150MB |
| 6 | Benchmarks, packaging, installer, auto-update | Signed Windows installer; benchmark suite in CI |

Phase 1 and 3 are the risky ones and carry the whole thesis. They get built and measured
before any polish work happens.

## 6. Benchmarking

`bench/generate.mjs` builds synthetic repositories (via `git fast-import`, so 20k commits
takes seconds rather than a quarter of an hour) and `bench/run.mjs` times the git commands
the hot paths are built from.

```sh
pnpm bench:generate      # fixtures: small, medium, medium-node_modules
pnpm bench               # table of medians
pnpm bench -- --json     # for tracking over time
```

**What it measures, and what it does not.** These numbers are git's own cost on this
machine — the floor the app builds on. They are not a measurement of the app, and anything
slower in the window is ours. Frame times, first paint, and idle RAM are still unmeasured.

### First results

Windows 10, git 2.55, NTFS, medians of 5 after a warm-up.

| Fixture | status | log page | log +5k | refs | commit detail |
| --- | --- | --- | --- | --- | --- |
| small (1k commits) | 39.6 | 40.9 | 29.8 | 28.7 | 32.4 |
| medium (20k) | 39.5 | 39.3 | 44.3 | 33.2 | 34.1 |
| medium + 20k ignored files | 44.1 | 40.3 | 45.3 | 28.8 | 33.0 |

**The finding that matters: process spawn dominates.** `git --version` in the same
repository costs **26.8ms**, so roughly 70% of every call above is the cost of starting
git.exe, not of doing the work. That is why the table is nearly flat across repository
sizes — at these sizes the work is 10-15ms and the spawn is the rest.

Two things follow:

1. **This is the evidence for the gitoxide plan in section 3.** Moving reads in-process
   removes a ~27ms floor from every status refresh, every page of history, every diff.
   Nothing else available to us is worth that much.
2. **Section 2's rule 4 is worth more than it looks.** One backend for N repos matters
   because the alternative pays that spawn cost per repo, per refresh.

### A claim of ours that did not survive

`git/cli.rs` describes `core.fsmonitor` as "the single biggest win on Windows". At 20k
ignored files it is not measurable: 37.8ms with it against 38.7ms without, which is inside
the noise.

That is not proof it is useless — a real `node_modules` is often 100k-300k files, the
fixture's tree is shallow, and it had just been written so the OS cache was hot. It does
mean the claim is currently unearned, and a fixture large enough to test it properly is the
next thing this harness needs.

### The app itself, measured

Linux (Arch, Hyprland, WebKitGTK), release build, 2026-09-05, with the nine
repositories of a real session restoring at launch.

| Measure | Result |
| --- | --- |
| Launch to window shown | 0.5 s. It was 5.3 s: the window was revealed from an animation frame, and WebKitGTK runs none for a hidden window, so every launch waited for the backend's five-second backstop |
| Memory after restore, whole process tree | about 570 MB: WebKit's web process 260, the backend 210, WebKit's network process 65 |
| Idle CPU over 30 s, nine repositories open | 0 % of one core |

Still to measure: history scroll frame times, and the same set against
SourceTree and lazygit. The memory number is worth a closer look: 210 MB in
the backend for nine repositories is more than the design intends.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| `gix` API gaps or churn | Reads sit behind our own `GitRead` trait; libgit2 or CLI fallback per method |
| Windows FS watching is unreliable at scale | Prefer git's own fsmonitor daemon; native watcher is the fallback, not the primary |
| Graph layout is the hard algorithm | Build it standalone with unit tests against known repos before wiring to UI |
| Scope creep into a SourceTree clone | The out-of-scope list above is enforced |
| Solo maintenance burden | Rust layer stays thin and mechanical; product logic lives in TypeScript |
