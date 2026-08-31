/** Every keyboard-reachable action in the app, in one place.
 *
 *  The catalog is pure data: it knows what a command is called and what keys it
 *  ships with, but nothing about how to run it. Handlers are supplied by
 *  whichever component owns the action, which is what lets a view register only
 *  the commands that make sense while it is on screen.
 *
 *  A binding is a string. "Mod+P" is one chord; "G F" is a sequence of two,
 *  pressed one after the other. Chords never contain a space, so the space is
 *  unambiguous as a separator — which is what lets a command hold a *list* of
 *  bindings without that list being confusable with a sequence.
 *
 *  Commands hold a list because one key is often not enough: a list should move
 *  on both J and ArrowDown, the way every list does.
 */

export type CommandScope = "global" | "status" | "history" | "sidebar";

/** commandId to every way it can be triggered. An empty list means unbound. */
export type Keymap = Record<string, string[]>;

export interface CommandDef {
  id: string;
  label: string;
  category: string;
  /** Where the command is live. A scoped command only exists while its view is
   *  showing, so two views may safely use the same key. */
  scope: CommandScope;
  binding: string[];
  /** Meaningless without a repository open. */
  needsRepo?: boolean;
}

export const COMMANDS: CommandDef[] = [
  // --- Application ---
  { id: "app.palette", label: "Command palette", category: "Application", scope: "global", binding: ["Mod+P"] },
  { id: "app.settings", label: "Settings", category: "Application", scope: "global", binding: ["Mod+,"] },
  { id: "app.activityLog", label: "Toggle activity log", category: "Application", scope: "global", binding: ["Mod+L"] },
  { id: "app.theme", label: "Cycle theme", category: "Application", scope: "global", binding: ["Mod+Shift+T"] },

  // --- Repositories ---
  { id: "repo.open", label: "Open repository", category: "Repository", scope: "global", binding: ["Mod+O"] },
  { id: "repo.create", label: "Create repository", category: "Repository", scope: "global", binding: ["Mod+N"] },
  { id: "repo.close", label: "Close repository tab", category: "Repository", scope: "global", binding: ["Mod+W"], needsRepo: true },
  { id: "repo.explorer", label: "Open in file manager", category: "Repository", scope: "global", binding: ["Mod+E"], needsRepo: true },
  { id: "repo.terminal", label: "Open in terminal", category: "Repository", scope: "global", binding: ["Mod+T"], needsRepo: true },

  // --- Repository tabs ---
  //
  // Ctrl+1..8 select a tab and Ctrl+9 selects the last one, the way browsers
  // do it: with two or three repositories open, "the last one" is reachable
  // far more often than a literal ninth tab would be.
  { id: "tab.next", label: "Next repository", category: "Repository", scope: "global", binding: ["Mod+Tab", "Mod+PageDown"], needsRepo: true },
  { id: "tab.previous", label: "Previous repository", category: "Repository", scope: "global", binding: ["Mod+Shift+Tab", "Mod+PageUp"], needsRepo: true },
  { id: "tab.1", label: "Go to repository 1", category: "Repository", scope: "global", binding: ["Mod+1"], needsRepo: true },
  { id: "tab.2", label: "Go to repository 2", category: "Repository", scope: "global", binding: ["Mod+2"], needsRepo: true },
  { id: "tab.3", label: "Go to repository 3", category: "Repository", scope: "global", binding: ["Mod+3"], needsRepo: true },
  { id: "tab.4", label: "Go to repository 4", category: "Repository", scope: "global", binding: ["Mod+4"], needsRepo: true },
  { id: "tab.5", label: "Go to repository 5", category: "Repository", scope: "global", binding: ["Mod+5"], needsRepo: true },
  { id: "tab.6", label: "Go to repository 6", category: "Repository", scope: "global", binding: ["Mod+6"], needsRepo: true },
  { id: "tab.7", label: "Go to repository 7", category: "Repository", scope: "global", binding: ["Mod+7"], needsRepo: true },
  { id: "tab.8", label: "Go to repository 8", category: "Repository", scope: "global", binding: ["Mod+8"], needsRepo: true },
  { id: "tab.last", label: "Go to the last repository", category: "Repository", scope: "global", binding: ["Mod+9"], needsRepo: true },

  // --- Panels ---
  //
  // Numbered the way lazygit numbers its panels: the digit is the shortcut, so
  // the number shown beside each panel is the literal key, not an ornament.
  { id: "panel.files", label: "Files", category: "Panels", scope: "global", binding: ["1"] },
  { id: "panel.history", label: "History", category: "Panels", scope: "global", binding: ["2"] },
  { id: "panel.branches", label: "Branches", category: "Panels", scope: "global", binding: ["3"], needsRepo: true },
  { id: "panel.remotes", label: "Remotes", category: "Panels", scope: "global", binding: ["4"], needsRepo: true },
  { id: "panel.stashes", label: "Stashes", category: "Panels", scope: "global", binding: ["5"], needsRepo: true },
  { id: "panel.worktrees", label: "Worktrees", category: "Panels", scope: "global", binding: ["6"], needsRepo: true },
  { id: "panel.submodules", label: "Submodules", category: "Panels", scope: "global", binding: ["7"], needsRepo: true },
  { id: "view.filter", label: "Focus the filter box", category: "Panels", scope: "global", binding: ["Mod+F"] },

  // --- Sidebar, live only while a sidebar panel has focus ---
  { id: "sidebar.next", label: "Next item", category: "Sidebar", scope: "sidebar", binding: ["J", "ArrowDown"] },
  { id: "sidebar.previous", label: "Previous item", category: "Sidebar", scope: "sidebar", binding: ["K", "ArrowUp"] },
  { id: "sidebar.activate", label: "Use the selected item", category: "Sidebar", scope: "sidebar", binding: ["Enter"] },
  { id: "sidebar.menu", label: "Open the item's menu", category: "Sidebar", scope: "sidebar", binding: ["Shift+Enter"] },
  { id: "sidebar.leave", label: "Return to the main panel", category: "Sidebar", scope: "sidebar", binding: ["Escape"] },

  // --- Git, lazygit-style single letters ---
  { id: "git.fetch", label: "Fetch", category: "Git", scope: "global", binding: ["F"], needsRepo: true },
  { id: "git.pull", label: "Pull", category: "Git", scope: "global", binding: ["P"], needsRepo: true },
  { id: "git.push", label: "Push", category: "Git", scope: "global", binding: ["Shift+P"], needsRepo: true },
  { id: "git.commit", label: "Write a commit message", category: "Git", scope: "global", binding: ["C"], needsRepo: true },
  { id: "git.branch", label: "New branch", category: "Git", scope: "global", binding: ["B"], needsRepo: true },
  { id: "git.merge", label: "Merge a branch", category: "Git", scope: "global", binding: ["M"], needsRepo: true },
  { id: "git.stash", label: "Stash changes", category: "Git", scope: "global", binding: ["S"], needsRepo: true },
  { id: "git.discardAll", label: "Discard all changes", category: "Git", scope: "global", binding: ["Shift+D"], needsRepo: true },
  { id: "git.flow", label: "Git flow", category: "Git", scope: "global", binding: ["G F"], needsRepo: true },

  // --- File Status ---
  { id: "status.next", label: "Next file", category: "File Status", scope: "status", binding: ["J", "ArrowDown"] },
  { id: "status.previous", label: "Previous file", category: "File Status", scope: "status", binding: ["K", "ArrowUp"] },
  { id: "status.toggle", label: "Stage or unstage the selected file", category: "File Status", scope: "status", binding: ["Space"] },
  { id: "status.stageAll", label: "Stage everything", category: "File Status", scope: "status", binding: ["A"] },
  { id: "status.unstageAll", label: "Unstage everything", category: "File Status", scope: "status", binding: ["Shift+A"] },
  { id: "status.discard", label: "Discard the selected file", category: "File Status", scope: "status", binding: ["Delete"] },
  { id: "status.commit", label: "Commit", category: "File Status", scope: "status", binding: ["Mod+Enter"] },

  // --- History ---
  { id: "history.next", label: "Next commit", category: "History", scope: "history", binding: ["J", "ArrowDown"] },
  { id: "history.previous", label: "Previous commit", category: "History", scope: "history", binding: ["K", "ArrowUp"] },
  { id: "history.top", label: "Jump to the newest commit", category: "History", scope: "history", binding: ["G G"] },
];

export const COMMANDS_BY_ID: Record<string, CommandDef> = Object.fromEntries(
  COMMANDS.map((command) => [command.id, command]),
);

/** Bindings as shipped. User overrides are layered on top of this. */
export const DEFAULT_KEYMAP: Keymap = Object.fromEntries(
  COMMANDS.map((command) => [command.id, command.binding]),
);

/** The chords a binding is made of. One is a chord; more is a sequence. */
export const chordsOf = (binding: string): string[] =>
  binding.trim().split(/\s+/).filter(Boolean);

export const isSequence = (binding: string): boolean => chordsOf(binding).length > 1;

/** Coerce whatever was stored into a binding list.
 *
 *  An array is a list of bindings, each of which may itself be a sequence
 *  written with spaces. A bare string is the older single-binding form and
 *  becomes a one-item list.
 *
 *  There is deliberately no attempt to read an array as one sequence: the
 *  recorder only ever wrote single strings, so no stored keymap contains an
 *  array from the older format, and guessing would silently join two working
 *  alternatives into one sequence that matches neither. */
export function normalizeBindings(value: unknown): string[] {
  if (typeof value === "string") return value === "" ? [] : [value];

  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  }

  return [];
}

/** Merge user overrides over the shipped defaults.
 *
 *  Overrides for commands that no longer exist are dropped, so a keymap saved
 *  by an older version cannot resurrect a removed command. */
export function resolveKeymap(overrides: Record<string, unknown> | undefined): Keymap {
  const resolved: Keymap = { ...DEFAULT_KEYMAP };

  for (const [id, value] of Object.entries(overrides ?? {})) {
    if (id in DEFAULT_KEYMAP) resolved[id] = normalizeBindings(value);
  }

  return resolved;
}

export interface Conflict {
  binding: string;
  commandIds: string[];
}

/** Bindings claimed by more than one command that can be live at the same time.
 *
 *  Two scoped commands in different views never collide, because only one of
 *  those views is mounted at a time. A global command collides with everything. */
export function findConflicts(keymap: Keymap): Conflict[] {
  const claims = new Map<string, string[]>();

  for (const [id, bindings] of Object.entries(keymap)) {
    for (const binding of bindings) {
      if (binding === "") continue;
      claims.set(binding, [...(claims.get(binding) ?? []), id]);
    }
  }

  const conflicts: Conflict[] = [];

  for (const [binding, ids] of claims) {
    if (ids.length < 2) continue;

    const clashing = ids.filter((id) =>
      ids.some((other) => other !== id && scopesOverlap(id, other)),
    );

    if (clashing.length > 1) conflicts.push({ binding, commandIds: clashing });
  }

  return conflicts;
}

function scopesOverlap(a: string, b: string): boolean {
  const first = COMMANDS_BY_ID[a]?.scope;
  const second = COMMANDS_BY_ID[b]?.scope;
  if (!first || !second) return false;

  return first === "global" || second === "global" || first === second;
}
