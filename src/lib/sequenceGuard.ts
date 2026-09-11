import { chordsOf, type Keymap } from "./commands";

/** Keeps a two-key sequence from also firing the single key it ends on.
 *
 *  `G F` opens the git flow menu, and `F` alone fetches. The hotkey library
 *  matches both against the second keystroke, so pressing the sequence
 *  fetched as well -- and there was no way to say which was meant, except
 *  that a G had just gone by. That is what this records: while a sequence
 *  prefix is fresh, a single-key command stays quiet, and the sequence
 *  either completes or times out.
 */
let armedUntil = 0;

export function arm(timeoutMs: number) {
  armedUntil = Date.now() + timeoutMs;
}

export function disarm() {
  armedUntil = 0;
}

export function isArmed(): boolean {
  return Date.now() < armedUntil;
}

/** The first chord of every sequence in the keymap: the keys that, when
 *  pressed, mean the next one belongs to them. Only plain single characters
 *  count; a sequence starting with a modifier chord is not a shape the app
 *  ships, and guessing at one would swallow keys for nothing. */
export function sequencePrefixes(keymap: Keymap): Set<string> {
  const prefixes = new Set<string>();
  for (const bindings of Object.values(keymap)) {
    for (const binding of bindings) {
      const steps = chordsOf(binding);
      const first = steps[0];
      if (steps.length > 1 && first && first.length === 1) prefixes.add(first.toUpperCase());
    }
  }
  return prefixes;
}

/** Whether a keystroke is one of the prefixes, pressed bare. */
export function isPrefixPress(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  prefixes: Set<string>,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1 && prefixes.has(event.key.toUpperCase());
}
