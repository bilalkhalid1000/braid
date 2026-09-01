import { describe, expect, it } from "vitest";

import { planFinish } from "./flowPlan";

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
