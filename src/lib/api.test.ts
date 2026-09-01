import { describe, expect, it } from "vitest";

import {
  badgeFor,
  diffTargetFor,
  flowNoun,
  isReleaseKind,
  isStaged,
  isUnstaged,
  operationLabel,
  submoduleLabel,
  type StatusEntry,
} from "./api";

/** A status row. Defaults are "unchanged on both sides". */
const entry = (over: Partial<StatusEntry> = {}): StatusEntry => ({
  path: "a.txt",
  origPath: null,
  kind: "ordinary",
  indexStatus: ".",
  worktreeStatus: ".",
  ...over,
});

describe("isStaged", () => {
  it("is true when the index differs from HEAD", () => {
    expect(isStaged(entry({ indexStatus: "M" }))).toBe(true);
  });

  it("is false when only the worktree changed", () => {
    expect(isStaged(entry({ worktreeStatus: "M" }))).toBe(false);
  });

  it("is false for an untracked file, whatever git wrote in the index column", () => {
    // Untracked rows carry "A" in porcelain v2 without being staged; treating
    // them as staged would show a file in Staged that git would not commit.
    expect(isStaged(entry({ kind: "untracked", indexStatus: "A" }))).toBe(false);
  });
});

describe("isUnstaged", () => {
  it("is true when the worktree differs from the index", () => {
    expect(isUnstaged(entry({ worktreeStatus: "M" }))).toBe(true);
  });

  it("is always true for an untracked file", () => {
    expect(isUnstaged(entry({ kind: "untracked" }))).toBe(true);
  });

  it("is false for something staged and then left alone", () => {
    expect(isUnstaged(entry({ indexStatus: "M" }))).toBe(false);
  });
});

describe("a file staged and then modified again", () => {
  it("appears on both sides, because it is on both sides", () => {
    // The one row that must be in Staged and Changes at once: committing now
    // takes the staged version and leaves the newer edit behind.
    const both = entry({ indexStatus: "M", worktreeStatus: "M" });

    expect(isStaged(both)).toBe(true);
    expect(isUnstaged(both)).toBe(true);
  });
});

describe("badgeFor", () => {
  it("marks a conflict before anything else", () => {
    // An unmerged row has letters in both columns, and neither is the thing
    // worth saying about it.
    expect(badgeFor(entry({ kind: "unmerged", indexStatus: "U" }), true)).toBe("!");
    expect(badgeFor(entry({ kind: "unmerged", worktreeStatus: "U" }), false)).toBe("!");
  });

  it("marks untracked as untracked on either side", () => {
    expect(badgeFor(entry({ kind: "untracked" }), false)).toBe("?");
  });

  it("shows the column belonging to the side being looked at", () => {
    const renamedThenEdited = entry({ indexStatus: "R", worktreeStatus: "M" });

    expect(badgeFor(renamedThenEdited, true)).toBe("R");
    expect(badgeFor(renamedThenEdited, false)).toBe("M");
  });
});

describe("diffTargetFor", () => {
  it("asks for the staged diff on the staged side", () => {
    expect(diffTargetFor(entry({ indexStatus: "M" }), true)).toBe("staged");
  });

  it("asks for the worktree diff on the other side", () => {
    expect(diffTargetFor(entry({ worktreeStatus: "M" }), false)).toBe("worktree");
  });

  it("has its own target for an untracked file", () => {
    // git has nothing to diff it against, so it is read rather than diffed.
    expect(diffTargetFor(entry({ kind: "untracked" }), false)).toBe("untracked");
  });

  it("still asks for the staged diff once an untracked file is staged", () => {
    expect(diffTargetFor(entry({ kind: "untracked" }), true)).toBe("staged");
  });
});

describe("labels", () => {
  it("names every flow kind", () => {
    for (const kind of ["feature", "bugfix", "release", "hotfix", "support"] as const) {
      expect(flowNoun[kind]).toBeTruthy();
    }
  });

  it("tags only the kinds that land on the production branch", () => {
    expect(isReleaseKind("release")).toBe(true);
    expect(isReleaseKind("hotfix")).toBe(true);
    expect(isReleaseKind("feature")).toBe(false);
    expect(isReleaseKind("bugfix")).toBe(false);
    expect(isReleaseKind("support")).toBe(false);
  });

  it("names every interrupted operation, since the banner shows this text", () => {
    for (const state of [
      "merging",
      "rebasing",
      "cherryPicking",
      "reverting",
      "bisecting",
    ] as const) {
      expect(operationLabel[state]).toBeTruthy();
    }
  });

  it("names every submodule state", () => {
    for (const state of ["uninitialized", "upToDate", "modified", "conflicted"] as const) {
      expect(submoduleLabel[state]).toBeTruthy();
    }
  });
});
