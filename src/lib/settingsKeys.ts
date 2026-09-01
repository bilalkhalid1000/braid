/** What a keystroke means in the settings dialog.
 *
 *  Pure, and separate from the dialog, because the dialog's own behaviour can
 *  only be checked by opening it and pressing things. Every mistake this file
 *  has had so far -- arrows moving sections instead of settings, a key being
 *  swallowed because a control happened to hold the focus -- was a decision,
 *  not a rendering problem.
 */
export type SettingsAction =
  | { kind: "close" }
  /** Out of the field being typed in, back to the cursor. */
  | { kind: "leave" }
  | { kind: "section"; index: number }
  | { kind: "move"; delta: number }
  | { kind: "adjust"; delta: number }
  | { kind: "activate" }
  | { kind: "none" };

const NONE: SettingsAction = { kind: "none" };

/** `editing` means a box with a caret in it has the keyboard. A select does not
 *  count: the cursor owns the arrows, and letting a focused select answer them
 *  as well is how the same key ends up doing two different things depending on
 *  whether the last thing you did was a click. */
export function settingsAction(
  key: string,
  editing: boolean,
  sections: number,
): SettingsAction {
  if (key === "Escape") return editing ? { kind: "leave" } : { kind: "close" };

  // Everything else belongs to the field while one is being typed into.
  if (editing) return NONE;

  const digit = Number(key);
  if (Number.isInteger(digit) && digit >= 1 && digit <= sections) {
    return { kind: "section", index: digit - 1 };
  }

  switch (key) {
    case "ArrowDown":
    case "j":
      return { kind: "move", delta: 1 };
    case "ArrowUp":
    case "k":
      return { kind: "move", delta: -1 };
    case "ArrowLeft":
    case "h":
      return { kind: "adjust", delta: -1 };
    case "ArrowRight":
    case "l":
      return { kind: "adjust", delta: 1 };
    case "Enter":
    case " ":
      return { kind: "activate" };
    default:
      return NONE;
  }
}

/** Where the cursor lands next.
 *
 *  `stops` are the indices of rows worth stopping on, in order. Null means
 *  there is nowhere to go, which is not the same as staying put -- the caller
 *  should leave the cursor alone rather than move it to 0.
 */
export function nextStop(stops: number[], cursor: number, delta: number): number | null {
  if (stops.length === 0) return null;

  const from = stops.indexOf(cursor);

  // Not on a stop: take the nearest one in the direction of travel rather than
  // counting from a position that is not in the list. Happens on a section
  // whose first rows are only there to be read.
  if (from === -1) {
    const ahead =
      delta > 0
        ? stops.find((index) => index > cursor)
        : [...stops].reverse().find((index) => index < cursor);

    return ahead ?? stops[0]!;
  }

  // Clamped, not wrapped: holding a direction settles at the end of the list
  // instead of reappearing at the other one.
  const next = Math.min(Math.max(from + delta, 0), stops.length - 1);
  return stops[next]!;
}
