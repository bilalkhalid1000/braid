import { validateHotkey } from "@tanstack/react-hotkeys";
import { describe, expect, it } from "vitest";

import { COMMANDS, chordsOf } from "./commands";

/** The keymap is only useful if the library agrees the keys exist.
 *
 *  A binding the library rejects is skipped silently at registration, so
 *  without this a typo in the catalog would ship as a shortcut that simply
 *  never fires. */
describe("every shipped binding is a key the library accepts", () => {
  for (const command of COMMANDS) {
    for (const binding of command.binding) {
      it(`${command.id}: ${binding}`, () => {
        for (const chord of chordsOf(binding)) {
          const result = validateHotkey(chord);
          expect(result.errors).toEqual([]);
          expect(result.valid).toBe(true);
        }
      });
    }
  }
});
