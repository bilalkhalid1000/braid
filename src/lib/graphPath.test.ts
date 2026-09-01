import { describe, expect, it } from "vitest";

import { laneX, linkPath } from "./graphPath";

/** Every coordinate in a path, in order. */
const points = (d: string) =>
  (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe("linkPath", () => {
  it("draws a straight line when the lane does not change", () => {
    // A branch that stays put is a column, and a curve command for it would
    // round-trip through floating point for nothing.
    expect(linkPath(10, 0, 10, 26)).toBe("M 10 0 L 10 26");
  });

  it("starts and ends exactly where it was told", () => {
    // The row above and below draw their own halves; a link that misses its
    // endpoint by a fraction shows as a kink at every row boundary.
    const p = points(linkPath(10, 0, 110, 13));

    expect(p.slice(0, 2)).toEqual([10, 0]);
    expect(p.slice(-2)).toEqual([110, 13]);
  });

  it("leaves and arrives vertically", () => {
    // Both control points share their endpoint's x, which is what makes the
    // tangent vertical at each end.
    const p = points(linkPath(10, 0, 110, 13));

    expect(p[2]).toBe(10);
    expect(p[4]).toBe(110);
  });

  it("never eases further than half the height", () => {
    // Otherwise the two control points cross and the curve doubles back.
    const p = points(linkPath(10, 0, 110, 4));

    expect(p[3]).toBeLessThanOrEqual(2);
    expect(p[5]).toBeGreaterThanOrEqual(2);
  });

  it("works upward as well as downward", () => {
    const p = points(linkPath(10, 26, 110, 0));

    expect(p.slice(0, 2)).toEqual([10, 26]);
    expect(p.slice(-2)).toEqual([110, 0]);
    // Control points stay between the endpoints rather than overshooting.
    expect(p[3]).toBeLessThan(26);
    expect(p[5]).toBeGreaterThan(0);
  });

  it("moves left as readily as right", () => {
    const p = points(linkPath(110, 0, 10, 13));

    expect(p.slice(0, 2)).toEqual([110, 0]);
    expect(p.slice(-2)).toEqual([10, 13]);
  });
});

describe("laneX", () => {
  it("centres a lane in its column", () => {
    expect(laneX(0, 10, 13)).toBe(6.5);
    expect(laneX(2, 10, 13)).toBe(32.5);
  });

  it("holds a lane past the cap inside the column", () => {
    // A repository busier than the cap still has links out there. Drawn at
    // their true position they land on the commit subject beside the graph.
    const width = 10 * 13;

    expect(laneX(14, 10, 13)).toBe(laneX(9, 10, 13));
    expect(laneX(14, 10, 13)).toBeLessThan(width);
  });

  it("never goes negative", () => {
    expect(laneX(-3, 10, 13)).toBe(6.5);
  });

  it("copes with a graph of one lane", () => {
    expect(laneX(5, 1, 13)).toBe(6.5);
    expect(laneX(0, 0, 13)).toBe(6.5);
  });
});
