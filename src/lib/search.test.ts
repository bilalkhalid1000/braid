import { describe, expect, it } from "vitest";

import { MIN_QUERY, SETTLE_MS, searchable } from "./search";

describe("searchable", () => {
  it("is false for nothing typed", () => {
    expect(searchable("")).toBe(false);
    expect(searchable("   ")).toBe(false);
  });

  it("is false for a single character", () => {
    // Every word typed passes through one, and `git grep e` across a large
    // repository is the most expensive search there is for the least useful
    // answer.
    expect(searchable("a")).toBe(false);
    expect(searchable("  a  ")).toBe(false);
  });

  it("is true from two characters", () => {
    expect(searchable("ab")).toBe(true);
    expect(searchable("  fix  ")).toBe(true);
  });

  it("counts what is left after trimming, not what was typed", () => {
    expect(searchable(" a ")).toBe(false);
  });

  it("keeps the numbers somewhere they can be read", () => {
    expect(MIN_QUERY).toBeGreaterThan(1);
    expect(SETTLE_MS).toBeGreaterThan(0);
  });
});
