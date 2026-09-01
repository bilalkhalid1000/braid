import { formatForDisplay } from "@tanstack/react-hotkeys";

import { chordsOf } from "./commands";

const LETTER = /^[A-Za-z]$/;
const SHIFTED_LETTER = /^Shift\+([A-Za-z])$/;

/** One chord, written so the case of a letter is what tells you about Shift.
 *
 *  "M" as a hotkey means the m key, but drawn as a capital it reads as Shift+M
 *  — and a reader who acts on that is simply wrong. Case is the oldest notation
 *  there is for this: vim, less, and lazygit all write `p` for pull and `P` for
 *  push, and every user of those tools already reads it that way. So an
 *  unshifted letter is lowercase and a shifted one is a capital, and the two
 *  can never be confused for each other again.
 *
 *  Only letters. "Ctrl+P" and "Esc" have nothing to gain from it and would only
 *  get stranger. */
function formatChord(chord: string): string {
  if (LETTER.test(chord)) return chord.toLowerCase();

  const shifted = SHIFTED_LETTER.exec(chord);
  if (shifted) return shifted[1]!.toUpperCase();

  return formatForDisplay(chord);
}

/** One binding written the way a keyboard shows it: "Ctrl+P", "g g".
 *
 *  A sequence keeps its space rather than gaining a plus, because that is how
 *  it is typed — one chord after another, not together. */
export function formatBinding(binding: string): string {
  return chordsOf(binding).map(formatChord).join(" ");
}

/** The binding to show when there is only room for one.
 *
 *  The first is the primary: defaults list the mnemonic before the arrow, so a
 *  hint reads "j" rather than the less memorable "ArrowDown". */
export function shortcutLabel(bindings: string[] | undefined): string {
  const first = bindings?.find((binding) => binding !== "");
  return first ? formatBinding(first) : "";
}
