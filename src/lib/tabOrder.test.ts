import { describe, expect, it } from "vitest";

import { applyOrder, landingIndex, moveItem } from "./tabOrder";

const repos = (...names: string[]) => names.map((id) => ({ id }));
const ids = (items: { id: string }[]) => items.map((r) => r.id);
const id = (r: { id: string }) => r.id;

describe("applyOrder", () => {
  it("puts items in the order given", () => {
    expect(ids(applyOrder(repos("a", "b", "c"), ["c", "a", "b"], id))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("keeps the source order when nothing is ordered yet", () => {
    expect(ids(applyOrder(repos("a", "b"), [], id))).toEqual(["a", "b"]);
  });

  it("puts a newly opened repository at the end", () => {
    // It has no place yet, and the end is where a new tab appears everywhere
    // else.
    expect(ids(applyOrder(repos("a", "b", "new"), ["b", "a"], id))).toEqual([
      "b",
      "a",
      "new",
    ]);
  });

  it("ignores ids that are no longer open", () => {
    // Closing a repository must not leave a hole its id can later fall into.
    expect(ids(applyOrder(repos("a", "c"), ["a", "b", "c"], id))).toEqual(["a", "c"]);
  });

  it("does not duplicate an id listed twice", () => {
    expect(ids(applyOrder(repos("a", "b"), ["a", "a", "b"], id))).toEqual(["a", "b"]);
  });

  it("handles an empty list", () => {
    expect(applyOrder([], ["a"], id)).toEqual([]);
  });
});

describe("moveItem", () => {
  it("moves an item forward", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("moving to its own place changes nothing", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 1, 1)).toBe(items);
  });

  it("refuses an index that is not there", () => {
    // A drag that ends outside the strip reports one; dropping the item would
    // be worse than ignoring the move.
    const items = ["a", "b"];
    expect(moveItem(items, 0, 5)).toBe(items);
    expect(moveItem(items, -1, 0)).toBe(items);
  });

  it("keeps every item", () => {
    const items = ["a", "b", "c", "d", "e"];
    for (let from = 0; from < items.length; from++) {
      for (let to = 0; to < items.length; to++) {
        expect([...moveItem(items, from, to)].sort()).toEqual([...items].sort());
      }
    }
  });
});

describe("landingIndex", () => {
  // A wide tab in the middle of two narrow ones -- the arrangement that broke.
  const lefts = [0, 60, 260];
  const widths = [60, 200, 60];
  const wide = 1;

  /** The furthest left this tab can travel before its edge leaves the strip. */
  const toStart = lefts[0]! - lefts[wide]!;
  const toEnd = lefts[2]! + widths[2]! - (lefts[wide]! + widths[wide]!);

  it("stays put when nothing has moved", () => {
    expect(landingIndex(lefts, widths, wide, 0)).toBe(wide);
  });

  it("a wide tab can reach the front of a narrow one", () => {
    // Measured by its centre this returns 1: the centre of a 200px tab held
    // against the left edge sits at 100, well past the first tab's centre of
    // 30, so it could never take first place.
    expect(landingIndex(lefts, widths, wide, toStart)).toBe(0);
  });

  it("a wide tab can reach the end past a narrow one", () => {
    expect(landingIndex(lefts, widths, wide, toEnd)).toBe(2);
  });

  it("a narrow tab can reach both ends past a wide one", () => {
    const narrow = 0;
    expect(landingIndex(lefts, widths, narrow, lefts[2]! + widths[2]! - widths[0]!)).toBe(2);
    expect(landingIndex(lefts, widths, 2, -lefts[2]!)).toBe(0);
  });

  it("does not move until the leading edge passes a neighbour's centre", () => {
    // Tab 0 nudged right by 20: its right edge reaches 80, short of tab 1's
    // centre at 160.
    expect(landingIndex(lefts, widths, 0, 20)).toBe(0);
    expect(landingIndex(lefts, widths, 0, 120)).toBe(1);
  });

  it("never returns an index that is not there", () => {
    for (const dx of [-10000, -1, 0, 1, 10000]) {
      for (let from = 0; from < lefts.length; from++) {
        const to = landingIndex(lefts, widths, from, dx);
        expect(to).toBeGreaterThanOrEqual(0);
        expect(to).toBeLessThan(lefts.length);
      }
    }
  });

  it("is a no-op for a single tab", () => {
    expect(landingIndex([0], [100], 0, 500)).toBe(0);
  });
});
