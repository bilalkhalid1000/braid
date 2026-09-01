import { describe, expect, it } from "vitest";

import { formatForDisplay } from "@tanstack/react-hotkeys";

import { formatBinding, shortcutLabel } from "./shortcutLabel";

describe("formatBinding", () => {
  it("writes an unshifted letter in lower case", () => {
    // "M" as a hotkey is the m key. Drawn as a capital it reads as Shift+M,
    // and a reader who acts on that presses the wrong thing.
    expect(formatBinding("M")).toBe("m");
    expect(formatBinding("P")).toBe("p");
  });

  it("writes a shifted letter as a capital, with no Shift+ prefix", () => {
    // The case is the notation, as in vim, less and lazygit.
    expect(formatBinding("Shift+P")).toBe("P");
    expect(formatBinding("Shift+M")).toBe("M");
  });

  it("leaves modifier combinations alone", () => {
    // Compared against the library rather than against a string: how a
    // modifier is drawn is the platform's business -- "Ctrl+P" on Windows and
    // Linux, "⌘ P" on a Mac. The rule here only promises not to touch it, and
    // spelling out one platform's answer made this pass on Windows and fail on
    // the Mac runner.
    for (const chord of ["Mod+P", "Mod+Shift+T", "Mod+Shift+PageUp", "Alt+Enter"]) {
      expect(formatBinding(chord)).toBe(formatForDisplay(chord));
    }
  });

  it("leaves named keys alone", () => {
    for (const key of ["Escape", "Space", "ArrowDown", "Delete"]) {
      expect(formatBinding(key)).toBe(formatForDisplay(key));
    }
  });

  it("keeps a sequence as separate chords", () => {
    expect(formatBinding("G F")).toBe("g f");
  });

  it("distinguishes the two halves of every shifted pair", () => {
    // The whole point: these must never render the same.
    for (const [plain, shifted] of [
      ["P", "Shift+P"],
      ["A", "Shift+A"],
      ["D", "Shift+D"],
      ["M", "Shift+M"],
    ]) {
      expect(formatBinding(plain!)).not.toBe(formatBinding(shifted!));
    }
  });
});

describe("shortcutLabel", () => {
  it("shows the first binding", () => {
    expect(shortcutLabel(["M", "Shift+M"])).toBe("m");
  });

  it("is empty when a command is unbound", () => {
    expect(shortcutLabel([])).toBe("");
    expect(shortcutLabel(undefined)).toBe("");
  });
});
