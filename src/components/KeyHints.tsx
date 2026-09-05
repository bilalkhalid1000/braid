import type { ReactNode } from "react";

import { COMMANDS, COMMANDS_BY_ID, type CommandScope } from "../lib/commands";
import { useSettings } from "../lib/settings";
import { shortcutLabel } from "../lib/shortcutLabel";
import { Keys } from "./Keys";

/** Global commands worth naming beside a scope's own: the ones you reach for
 *  from that panel, not the whole catalog. */
const GLOBALS: Partial<Record<CommandScope, string[]>> = {
  status: ["git.commit", "git.stash", "git.discardAll", "view.filter"],
  history: ["git.checkout", "git.tag", "view.search"],
  sidebar: ["git.new", "git.merge", "git.checkout", "git.tag", "git.remote", "view.filter"],
};

/** The keys live in a scope, as a strip: every command the scope owns, the
 *  globals that belong beside them, and the way to the full list. One of
 *  these sits above the status bar, always, for whichever section is active:
 *  inside a pane it scrolled away with the pane's content.
 *
 *  Read from the catalog and the user's keymap rather than written by hand,
 *  so a rebound or newly added command shows up here without anyone
 *  remembering to say so. A command with no key is left out: a hint for a
 *  key that does nothing is worse than none. */
export function KeyHints({ scope }: { scope: CommandScope | null }) {
  const { keymap } = useSettings();

  // With no list in front, the repository-wide keys are what is left.
  const ids = scope
    ? [
        ...COMMANDS.filter((command) => command.scope === scope).map((command) => command.id),
        ...(GLOBALS[scope] ?? []),
        "app.keys",
      ]
    : ["git.commit", "git.pull", "git.push", "git.fetch", "git.new", "app.palette", "app.keys"];

  const items: ReactNode[] = [];

  for (const id of ids) {
    const command = COMMANDS_BY_ID[id];
    const keys = keymap[id] ?? [];
    if (!command || keys.length === 0) continue;

    // Next and previous are one idea, shown as one pair of keys.
    if (id.endsWith(".previous") && COMMANDS_BY_ID[id.replace(/\.previous$/, ".next")]) continue;
    if (id.endsWith(".next")) {
      const previous = keymap[id.replace(/\.next$/, ".previous")] ?? [];
      items.push(
        <Keys key={id}>
          <kbd>{shortcutLabel(keys)}</kbd>
          {previous.length > 0 && <kbd>{shortcutLabel(previous)}</kbd>} move
        </Keys>,
      );
      continue;
    }

    items.push(
      <Keys key={id}>
        <kbd>{shortcutLabel(keys)}</kbd> {command.short ?? command.label.toLowerCase()}
      </Keys>,
    );
  }

  return (
    <p className="pane-hint">
      {items.flatMap((item, i) => (i === 0 ? [item] : [" · ", item]))}
    </p>
  );
}
