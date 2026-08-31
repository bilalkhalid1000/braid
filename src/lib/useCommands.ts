import {
  useHotkeys,
  useHotkeySequences,
  validateHotkey,
  type Hotkey,
  type HotkeySequence,
  type UseHotkeyDefinition,
  type UseHotkeySequenceDefinition,
} from "@tanstack/react-hotkeys";

import { chordsOf } from "./commands";
import { useSettings } from "./settings";

export type CommandHandlers = Record<string, (() => void) | undefined>;

/** Bind a set of commands to whatever keys the user has them on.
 *
 *  Components register only the commands they own, so a binding exists exactly
 *  while the thing it acts on is on screen. That is what lets the File Status,
 *  History and Sidebar panels all use J without colliding: the panels are not
 *  mutually exclusive as components — the sidebar is mounted the whole time —
 *  but only one of them holds the keyboard.
 *
 *  Which is why `enabled` removes the registrations rather than being passed to
 *  the library as an option. TanStack keeps a disabled registration alive and
 *  only suppresses its callback, so passing the flag through would leave three
 *  live handlers on J and earn a console warning for every one. Registering
 *  nothing while a panel is inactive keeps the registry honest: what is
 *  registered is exactly what can fire, so a warning from the library always
 *  means a genuine clash rather than our own layering.
 *
 *  Every binding on a command is registered, so a list can answer to both J and
 *  ArrowDown without either being the "real" one.
 *
 *  The definition arrays are rebuilt every render rather than memoized. That is
 *  deliberate: TanStack re-syncs callbacks on each render to avoid stale
 *  closures, and a memoized array would defeat it by holding the first render's
 *  handlers forever. A single call to each array hook keeps the hook count
 *  constant however many commands are passed.
 */
export function useCommands(handlers: CommandHandlers, enabled = true) {
  const { keymap, settings } = useSettings();

  const chords: UseHotkeyDefinition[] = [];
  const sequences: UseHotkeySequenceDefinition[] = [];

  if (enabled) {
    for (const [id, handler] of Object.entries(handlers)) {
      if (!handler) continue;

      for (const binding of keymap[id] ?? []) {
        const steps = chordsOf(binding);
        if (steps.length === 0) continue;

        // Bindings come from a file the user can edit by hand, so they are
        // checked rather than trusted. One bad entry skips itself instead of
        // taking the whole keymap down with it.
        if (!steps.every((chord) => validateHotkey(chord).valid)) continue;

        if (steps.length > 1) {
          sequences.push({
            sequence: steps as HotkeySequence,
            callback: () => handler(),
            options: { timeout: settings.sequenceTimeout },
          });
        } else {
          chords.push({ hotkey: steps[0] as Hotkey, callback: () => handler() });
        }
      }
    }
  }

  useHotkeys(chords);
  useHotkeySequences(sequences);
}
