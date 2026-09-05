import { describe, expect, it } from "vitest";

import { nextConflict } from "./conflicts";

describe("nextConflict", () => {
  const kinds = ["modified", "unmerged", "added", "unmerged", "deleted"];

  it("walks forward and wraps", () => {
    expect(nextConflict(kinds, 0, 1)).toBe(1);
    expect(nextConflict(kinds, 1, 1)).toBe(3);
    expect(nextConflict(kinds, 3, 1)).toBe(1);
  });

  it("walks backward and wraps", () => {
    expect(nextConflict(kinds, 1, -1)).toBe(3);
    expect(nextConflict(kinds, 0, -1)).toBe(3);
  });

  it("starts from an end with nothing selected", () => {
    expect(nextConflict(kinds, -1, 1)).toBe(1);
    expect(nextConflict(kinds, -1, -1)).toBe(3);
  });

  it("finds nothing when nothing is conflicted", () => {
    expect(nextConflict(["modified", "added"], 0, 1)).toBe(-1);
    expect(nextConflict([], -1, 1)).toBe(-1);
  });
});
