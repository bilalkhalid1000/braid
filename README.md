# Braid

A fast, keyboard-first Git GUI. Built because SourceTree becomes unusable with
several repositories open at once.

See [PLAN.md](./PLAN.md) for the architecture, the performance rules the design
is built around, and the phased roadmap.

## Status

The layout follows SourceTree deliberately: repo tabs, an icon toolbar, a
sidebar of Workspace / Branches / Tags / Remotes / Stashes / Worktrees /
Submodules, and a File Status screen with staged above unstaged and the diff
to the right.

Working today:

- Several repositories open at once, as tabs
- Live working-copy status driven by filesystem events (never polled)
- Stage / unstage / discard by file, whole-section toggles, commit with amend
- Unified diff viewer, virtualized, with binary and oversize-file handling
- History browser, paged and virtualized, with commit details
- Branches, tags, remotes, stashes; fetch, pull, push, merge, checkout
- Worktrees: list, add, remove, prune, and open any worktree as its own tab
- Submodules: state per submodule, init/update, and open one as its own tab
- Light, dark, and follow-the-system themes

Not built yet: branch lanes in the history graph, hunk and line staging,
conflict resolution, command palette. Those are Phases 3–5 in the plan.

## Requirements

- Rust (stable) and the MSVC toolchain
- Node 20+ and pnpm
- Git 2.37 or newer, for the built-in filesystem monitor

## Development

```sh
pnpm install
pnpm tauri dev
```

```sh
pnpm build                                   # typecheck + build the frontend
pnpm test                                    # frontend unit tests
pnpm tauri build                             # release binary + installer

cargo test  --manifest-path src-tauri/Cargo.toml   # all Rust tests
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

## Tests

Two kinds, and the difference matters.

**Unit tests** live beside the code and cover the parsers, the patch builder and
path handling. They run against strings written by hand, which proves the logic but
says nothing about whether git actually produces that shape.

**Integration tests** in `src-tauri/tests/` close that gap. Each one creates a real
repository in a temporary directory, drives it with real git, and reads the result
back through the same functions the app calls. They cover status in every state,
diffs, hunk and line staging, history and refs, commit detail, merge and rebase
conflicts, worktrees, submodules and git flow.

Each test repository sets its own `user.name`, `user.email` and disables signing, so
the suite does not pass or fail depending on whose machine it runs on. They use
`Git::plain` rather than `Git::new`, because `core.fsmonitor` starts a daemon that
holds a handle to the worktree and would stop the test deleting its own repository
on Windows.

## Benchmarks

```sh
pnpm bench:generate     # synthetic repositories, via git fast-import
pnpm bench              # medians per git call
```

These measure git's own cost on the machine, not the app — see PLAN.md section 6,
which records the first results and one claim of ours they did not support.

## The icon

`src-tauri/icons/braid.svg` is the source of truth. It draws the same thing
the history view does — a trunk, a lane that diverges and merges back, and a
hollow ring for the merge — using the same curve construction as
`CommitGraph.tsx`, so the mark and the app agree.

To change it, edit the SVG and regenerate:

```sh
node scripts/icon.mjs                          # SVG -> icons/source.png
pnpm tauri icon src-tauri/icons/source.png     # source.png -> .ico, .icns, PNGs
```

Check the result at 32px before committing. The proportions are tuned for that
size: the branch's parallel run has to carry about a third of its length, or the
two curves meet and the shape closes into a balloon.

## Notes on behaviour

**Reads and writes take different paths.** Writes shell out to your own `git`,
so hooks, credential helpers, GPG signing, LFS and `.gitconfig` behave exactly as
they do in your terminal. Reads currently do too, and will move to gitoxide once
the benchmark harness can show the difference.

**Your git config is never modified.** The performance settings this app relies
on (`core.fsmonitor`, `core.untrackedCache`) are passed per-invocation with
`-c`. Enabling fsmonitor does start git's own background daemon for a repo; it
exits on its own when idle.

**Nothing polls.** Status refreshes come from a filesystem watcher, debounced,
with `.git/objects`, `node_modules` and similar noise filtered out. An idle repo
costs no CPU, which is what makes many open tabs viable.
