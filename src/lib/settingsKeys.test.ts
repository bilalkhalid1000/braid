import { describe, expect, it } from "vitest";

import { nextStop, settingsAction } from "./settingsKeys";

const act = (key: string, editing = false) => settingsAction(key, editing, 5);

describe("settingsAction", () => {
  it("moves between settings with the arrows, not between sections", () => {
    // The bug this replaces: Down switched section from anywhere in the
    // dialog, so reading one list threw you into another.
    expect(act("ArrowDown")).toEqual({ kind: "move", delta: 1 });
    expect(act("ArrowUp")).toEqual({ kind: "move", delta: -1 });
  });

  it("changes the highlighted setting with left and right", () => {
    expect(act("ArrowLeft")).toEqual({ kind: "adjust", delta: -1 });
    expect(act("ArrowRight")).toEqual({ kind: "adjust", delta: 1 });
  });

  it("takes hjkl too, the way every other list in the app does", () => {
    expect(act("j")).toEqual({ kind: "move", delta: 1 });
    expect(act("k")).toEqual({ kind: "move", delta: -1 });
    expect(act("h")).toEqual({ kind: "adjust", delta: -1 });
    expect(act("l")).toEqual({ kind: "adjust", delta: 1 });
  });

  it("jumps to a section by its number", () => {
    expect(act("1")).toEqual({ kind: "section", index: 0 });
    expect(act("5")).toEqual({ kind: "section", index: 4 });
  });

  it("ignores a digit past the last section", () => {
    expect(act("6")).toEqual({ kind: "none" });
    expect(act("0")).toEqual({ kind: "none" });
  });

  it("activates on Enter and Space", () => {
    expect(act("Enter")).toEqual({ kind: "activate" });
    expect(act(" ")).toEqual({ kind: "activate" });
  });

  it("closes on Escape", () => {
    expect(act("Escape")).toEqual({ kind: "close" });
  });

  it("gives every key to a field being typed into", () => {
    // Otherwise typing 3 in the page-size box jumps to Shortcuts, and typing
    // a j in a command line moves the cursor instead.
    for (const key of ["j", "3", "ArrowDown", "ArrowLeft", "Enter", " ", "l"]) {
      expect(act(key, true)).toEqual({ kind: "none" });
    }
  });

  it("leaves the field on Escape rather than closing the dialog", () => {
    // Closing from inside a box you were typing in loses what you typed.
    expect(act("Escape", true)).toEqual({ kind: "leave" });
  });

  it("passes on keys it has no use for", () => {
    expect(act("Tab")).toEqual({ kind: "none" });
    expect(act("x")).toEqual({ kind: "none" });
  });
});

describe("nextStop", () => {
  it("steps through the stops", () => {
    expect(nextStop([0, 1, 2], 0, 1)).toBe(1);
    expect(nextStop([0, 1, 2], 2, -1)).toBe(1);
  });

  it("skips the rows that answer no key", () => {
    // About has two lines that only state a version. Landing on one and
    // pressing right would do nothing, which reads as the keys being broken.
    expect(nextStop([1, 4, 5], 1, 1)).toBe(4);
  });

  it("settles at the ends rather than wrapping", () => {
    expect(nextStop([0, 1, 2], 2, 1)).toBe(2);
    expect(nextStop([0, 1, 2], 0, -1)).toBe(0);
  });

  it("finds its way from a row that is not a stop", () => {
    expect(nextStop([2, 5], 0, 1)).toBe(2);
    expect(nextStop([2, 5], 9, -1)).toBe(5);
  });

  it("falls to the first stop when there is none the way it was heading", () => {
    expect(nextStop([2, 5], 9, 1)).toBe(2);
  });

  it("has nowhere to go in a section with nothing to change", () => {
    expect(nextStop([], 0, 1)).toBeNull();
  });
});
