import { formatForDisplay } from "@tanstack/react-hotkeys";

import { chordsOf } from "./commands";

/** One binding written the way a keyboard shows it: "Ctrl+P", "G G".
 *
 *  A sequence keeps its space rather than gaining a plus, because that is how
 *  it is typed — one chord after another, not together. */
export function formatBinding(binding: string): string {
  return chordsOf(binding)
    .map((chord) => formatForDisplay(chord))
    .join(" ");
}

/** The binding to show when there is only room for one.
 *
 *  The first is the primary: defaults list the mnemonic before the arrow, so a
 *  hint reads "J" rather than the less memorable "ArrowDown". */
export function shortcutLabel(bindings: string[] | undefined): string {
  const first = bindings?.find((binding) => binding !== "");
  return first ? formatBinding(first) : "";
}
