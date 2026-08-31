import { describe, expect, it } from "vitest";

import { buildGraph, type GraphCommit } from "./graph";

/** Commits are written newest first, the order `git log` produces. */
const commits = (...entries: [string, ...string[]][]): GraphCommit[] =>
  entries.map(([oid, ...parents]) => ({ oid, parents }));

describe("buildGraph", () => {
  it("keeps a linear history in one lane", () => {
    const { rows, maxLanes } = buildGraph(
      commits(["c", "b"], ["b", "a"], ["a"]),
    );

    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(maxLanes).toBe(1);
  });

  it("gives every row the same color in a linear history", () => {
    const { rows } = buildGraph(commits(["c", "b"], ["b", "a"], ["a"]));
    expect(new Set(rows.map((r) => r.color)).size).toBe(1);
  });

  it("stops drawing below a root commit", () => {
    const { rows } = buildGraph(commits(["b", "a"], ["a"]));
    expect(rows[1].down).toEqual([]);
  });

  it("opens a second lane for a divergent tip", () => {
    // Two tips, both descending from `a`.
    const { rows, maxLanes } = buildGraph(
      commits(["feature", "a"], ["main", "a"], ["a"]),
    );

    expect(rows[0].lane).toBe(0);
    expect(rows[1].lane).toBe(1);
    expect(maxLanes).toBe(2);
  });

  it("colors divergent branches differently", () => {
    const { rows } = buildGraph(commits(["feature", "a"], ["main", "a"], ["a"]));
    expect(rows[0].color).not.toBe(rows[1].color);
  });

  it("converges both lanes onto the shared ancestor", () => {
    const { rows } = buildGraph(commits(["feature", "a"], ["main", "a"], ["a"]));

    // The row for `a` is reached from both lanes.
    const targets = rows[2].up.map((link) => `${link.from}->${link.to}`);
    expect(targets).toContain("0->0");
    expect(targets).toContain("1->0");
  });

  it("frees a lane once its branch has merged", () => {
    const { rows, maxLanes } = buildGraph(
      commits(["a", "a"], ["a", "a"]),
    );

    // Degenerate input must not loop or expand without bound.
    expect(rows).toHaveLength(2);
    expect(maxLanes).toBeLessThanOrEqual(2);
  });

  it("marks a merge and links out to its second parent", () => {
    const { rows } = buildGraph(
      commits(["merge", "main", "topic"], ["topic", "base"], ["main", "base"], ["base"]),
    );

    expect(rows[0].isMerge).toBe(true);

    // The merge opens a lane for the second parent, drawn from the node.
    const branchOut = rows[0].down.find((link) => link.from !== link.to);
    expect(branchOut).toBeDefined();
    expect(branchOut!.from).toBe(rows[0].lane);
  });

  it("does not mark an ordinary commit as a merge", () => {
    const { rows } = buildGraph(commits(["b", "a"], ["a"]));
    expect(rows.every((r) => !r.isMerge)).toBe(true);
  });

  it("keeps the first parent in the commit's own lane", () => {
    const { rows } = buildGraph(
      commits(["merge", "main", "topic"], ["topic", "base"], ["main", "base"], ["base"]),
    );

    // The merge sits in lane 0 and `main`, its first parent, stays there.
    expect(rows[0].lane).toBe(0);
    expect(rows[2].lane).toBe(0);
  });

  it("reuses a freed slot rather than growing forever", () => {
    // A short-lived branch opens lane 1, merges, then a later branch appears.
    const { maxLanes } = buildGraph(
      commits(
        ["e", "d"],
        ["d", "c", "b"],
        ["b", "a"],
        ["c", "a"],
        ["a"],
      ),
    );

    expect(maxLanes).toBe(2);
  });

  it("handles an empty history", () => {
    const { rows, maxLanes } = buildGraph([]);
    expect(rows).toEqual([]);
    expect(maxLanes).toBe(1);
  });

  it("emits one upward link per active lane", () => {
    const { rows } = buildGraph(
      commits(["feature", "a"], ["main", "a"], ["a"]),
    );

    // While two branches are open, the row between them carries both lines.
    expect(rows[1].up).toHaveLength(2);
  });
});
