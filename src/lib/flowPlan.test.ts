import { describe, expect, it } from "vitest";

import { planFinish, planStart } from "./flowPlan";

const HOTFIX = "hotfix/sql-escape";

const versioned = () =>
  planFinish(HOTFIX, [
    { branch: "master", tag: "1.4.2" },
    { branch: "develop" },
  ]);

describe("planFinish", () => {
  it("reads newest first, the way history does", () => {
    // git flow lands on master and tags it before merging back, so the merge
    // into develop is the youngest commit and belongs at the top.
    const { rows } = versioned();

    expect(rows.map((row) => row.key)).toEqual(["develop", "master", "branch"]);
  });

  it("names the branch each merge lands on", () => {
    const { rows } = versioned();

    expect(rows[0]!.subject).toBe(`Merge branch '${HOTFIX}' into develop`);
    expect(rows[1]!.subject).toBe(`Merge branch '${HOTFIX}' into master`);
  });

  it("puts the tag where it is actually written", () => {
    // On master, not on develop: a release is tagged where it ships from.
    const { rows } = versioned();

    expect(rows[0]!.chips.map((chip) => chip.label)).toEqual(["develop"]);
    expect(rows[1]!.chips.map((chip) => chip.label)).toEqual(["master", "1.4.2"]);
    expect(rows[1]!.chips[1]!.kind).toBe("ref-tag");
  });

  it("ends on the branch being finished", () => {
    const { rows } = versioned();
    const last = rows[rows.length - 1]!;

    expect(last.chips[0]!.label).toBe(HOTFIX);
  });

  it("draws both merges as merges", () => {
    // Two parents each: where they came from, and the branch. A merge that
    // draws as an ordinary commit would show a fast-forward, which --no-ff
    // is there to prevent.
    const { graph } = versioned();

    expect(graph.rows[0]!.isMerge).toBe(true);
    expect(graph.rows[1]!.isMerge).toBe(true);
    expect(graph.rows[2]!.isMerge).toBe(false);
  });

  it("gives the branch and its two destinations lanes of their own", () => {
    const { graph } = versioned();

    expect(graph.maxLanes).toBeGreaterThanOrEqual(3);
  });

  it("has one merge for a feature, which is never tagged", () => {
    const { rows, graph } = planFinish("feature/search", [{ branch: "develop" }]);

    expect(rows.map((row) => row.key)).toEqual(["develop", "branch"]);
    expect(rows.every((row) => row.chips.every((chip) => chip.kind === "ref-local"))).toBe(
      true,
    );
    expect(graph.rows).toHaveLength(2);
  });
});

describe("planStart", () => {
  it("puts the new branch above the base it is cut from", () => {
    const { rows, graph } = planStart("hotfix/1.0.2", "master", "Merge branch 'x'");

    expect(rows.map((row) => row.key)).toEqual(["ahead", "new", "tip", "older"]);
    expect(rows[1]!.chips[0]!.label).toBe("hotfix/1.0.2");
    expect(rows[2]!.chips[0]!.label).toBe("master");
    expect(rows[2]!.subject).toBe("Merge branch 'x'");
    // The trunk holds the first lane; the new branch steps off it to the
    // side and its link comes back into the trunk's lane at the tip.
    expect(graph.rows[0]!.lane).toBe(0);
    expect(graph.rows[1]!.lane).toBe(1);
    expect(graph.rows[2]!.up).toContainEqual(expect.objectContaining({ from: 1, to: 0 }));
    expect(graph.rows[2]!.lane).toBe(0);
    // And keeps going below the preview: the last parent is not drawn.
    expect(graph.rows[3]!.down.length).toBe(1);
  });
});
