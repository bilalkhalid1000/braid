import { describe, expect, it } from "vitest";

import {
  COMMANDS,
  COMMANDS_BY_ID,
  DEFAULT_KEYMAP,
  chordsOf,
  findConflicts,
  isSequence,
  normalizeBindings,
  resolveKeymap,
} from "./commands";

describe("the command catalog", () => {
  it("has no duplicate ids", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every command a label, a category and at least one key", () => {
    for (const command of COMMANDS) {
      expect(command.label.length).toBeGreaterThan(0);
      expect(command.category.length).toBeGreaterThan(0);
      expect(command.binding.length).toBeGreaterThan(0);
    }
  });

  it("ships without conflicting bindings", () => {
    // The defaults are the one keymap we control completely; shipping a clash
    // in it would be our bug, not the user's.
    expect(findConflicts(DEFAULT_KEYMAP)).toEqual([]);
  });

  it("gives every list an arrow key as well as a letter", () => {
    // A list that only answers to J is a list most people cannot drive.
    for (const id of ["sidebar.next", "status.next", "history.next"]) {
      expect(DEFAULT_KEYMAP[id]).toContain("ArrowDown");
    }
    for (const id of ["sidebar.previous", "status.previous", "history.previous"]) {
      expect(DEFAULT_KEYMAP[id]).toContain("ArrowUp");
    }
  });
});

describe("chordsOf and isSequence", () => {
  it("splits a sequence on the space", () => {
    expect(chordsOf("G F")).toEqual(["G", "F"]);
    expect(chordsOf("Mod+P")).toEqual(["Mod+P"]);
  });

  it("treats a chord with modifiers as one step", () => {
    // The separator is a space, so a plus never splits anything.
    expect(chordsOf("Mod+Shift+T")).toEqual(["Mod+Shift+T"]);
    expect(isSequence("Mod+Shift+T")).toBe(false);
  });

  it("recognises a sequence only when there is a second chord", () => {
    expect(isSequence("G G")).toBe(true);
    expect(isSequence("G")).toBe(false);
    expect(isSequence("")).toBe(false);
  });

  it("tolerates stray whitespace", () => {
    expect(chordsOf("  G   F  ")).toEqual(["G", "F"]);
  });
});

describe("normalizeBindings", () => {
  it("wraps a stored chord into a list", () => {
    expect(normalizeBindings("Mod+P")).toEqual(["Mod+P"]);
  });

  it("reads an empty string as unbound", () => {
    expect(normalizeBindings("")).toEqual([]);
  });

  it("reads an array as a list of alternatives", () => {
    expect(normalizeBindings(["J", "ArrowDown"])).toEqual(["J", "ArrowDown"]);
  });

  it("keeps a sequence inside a list intact", () => {
    // The space is what makes this one sequence rather than two keys, and it
    // has to survive the round trip.
    expect(normalizeBindings(["G F", "Mod+G"])).toEqual(["G F", "Mod+G"]);
  });

  it("reads a one-element array as a plain chord", () => {
    expect(normalizeBindings(["Mod+P"])).toEqual(["Mod+P"]);
  });

  it("discards anything else rather than throwing", () => {
    expect(normalizeBindings(undefined)).toEqual([]);
    expect(normalizeBindings(42)).toEqual([]);
    expect(normalizeBindings({})).toEqual([]);
    expect(normalizeBindings([1, null])).toEqual([]);
  });
});

describe("resolveKeymap", () => {
  it("returns the defaults when nothing is overridden", () => {
    expect(resolveKeymap(undefined)).toEqual(DEFAULT_KEYMAP);
    expect(resolveKeymap({})).toEqual(DEFAULT_KEYMAP);
  });

  it("layers an override over the default", () => {
    const resolved = resolveKeymap({ "git.pull": ["Mod+Shift+U"] });

    expect(resolved["git.pull"]).toEqual(["Mod+Shift+U"]);
    expect(resolved["git.push"]).toEqual(DEFAULT_KEYMAP["git.push"]);
  });

  it("keeps several keys on one command", () => {
    const resolved = resolveKeymap({ "git.pull": ["P", "Mod+Shift+U"] });
    expect(resolved["git.pull"]).toEqual(["P", "Mod+Shift+U"]);
  });

  it("accepts a keymap written by an older version", () => {
    const resolved = resolveKeymap({ "git.pull": "Mod+Shift+U" });
    expect(resolved["git.pull"]).toEqual(["Mod+Shift+U"]);
  });

  it("keeps an empty list, which is how a command is unbound", () => {
    expect(resolveKeymap({ "git.pull": [] })["git.pull"]).toEqual([]);
  });

  it("drops overrides for commands that no longer exist", () => {
    // A keymap saved by an older version must not resurrect a removed command.
    const resolved = resolveKeymap({ "git.timeTravel": ["Mod+T"] });
    expect(resolved["git.timeTravel"]).toBeUndefined();
  });
});

describe("findConflicts", () => {
  it("reports two global commands sharing a binding", () => {
    const conflicts = findConflicts({
      ...DEFAULT_KEYMAP,
      "git.pull": ["Mod+P"], // already the command palette
    });

    const clash = conflicts.find((c) => c.binding === "Mod+P");
    expect(clash?.commandIds).toContain("git.pull");
    expect(clash?.commandIds).toContain("app.palette");
  });

  it("checks every key on a command, not just the first", () => {
    const conflicts = findConflicts({
      ...DEFAULT_KEYMAP,
      "git.pull": ["P", "Mod+P"],
    });

    expect(conflicts.some((c) => c.binding === "Mod+P")).toBe(true);
  });

  it("allows two views to use the same key", () => {
    // status.next and history.next both ship as J and never coexist, because
    // only one of those views is mounted at a time.
    expect(DEFAULT_KEYMAP["status.next"]).toContain("J");
    expect(DEFAULT_KEYMAP["history.next"]).toContain("J");
    expect(findConflicts(DEFAULT_KEYMAP)).toEqual([]);
  });

  it("reports a scoped command clashing with a global one", () => {
    const conflicts = findConflicts({
      ...DEFAULT_KEYMAP,
      "status.stageAll": ["F"], // git.fetch is global
    });

    const clash = conflicts.find((c) => c.binding === "F");
    expect(clash?.commandIds).toEqual(
      expect.arrayContaining(["status.stageAll", "git.fetch"]),
    );
  });

  it("ignores unbound commands", () => {
    const conflicts = findConflicts({
      ...DEFAULT_KEYMAP,
      "git.pull": [],
      "git.push": [],
    });

    expect(conflicts.every((c) => c.binding !== "")).toBe(true);
  });

  it("does not confuse a sequence with a chord of the same letters", () => {
    const conflicts = findConflicts({
      "a.one": ["G F"],
      "a.two": ["G+F"],
    });

    expect(conflicts).toEqual([]);
  });

  it("keeps every catalog command resolvable by id", () => {
    for (const command of COMMANDS) {
      expect(COMMANDS_BY_ID[command.id]).toBe(command);
    }
  });
});
