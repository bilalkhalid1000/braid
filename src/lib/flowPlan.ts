import { buildGraph, type Graph } from "./graph";

export interface FlowPlanTarget {
  branch: string;
  /** The tag git flow writes on arrival. Release and hotfix only. */
  tag?: string;
}

export interface PlanChip {
  label: string;
  kind: "ref-local" | "ref-tag";
}

export interface PlanRow {
  key: string;
  subject: string;
  chips: PlanChip[];
}

/** The history a git flow finish will leave behind.
 *
 *  Built as commits and handed to the same graph builder the history view
 *  uses, so the preview is drawn by the code that draws the real thing rather
 *  than by a second diagram kept in step by hand.
 */
export function planFinish(from: string, targets: FlowPlanTarget[]): {
  graph: Graph;
  rows: PlanRow[];
} {
  // Newest first, the way history reads. git flow lands on master and tags it
  // before merging back, so the develop merge is the youngest commit.
  const merges = [...targets].reverse();

  // The parents not in this list -- each target's current tip, and the commit
  // the branch grew from -- are left dangling on purpose. Their lanes run off
  // the bottom edge, which is what history does: there is more of it below.
  const graph = buildGraph([
    ...merges.map((target) => ({
      oid: `merge:${target.branch}`,
      parents: [`tip:${target.branch}`, "branch"],
    })),
    { oid: "branch", parents: ["base"] },
  ]);

  const rows: PlanRow[] = [
    ...merges.map((target) => ({
      key: target.branch,
      subject: `Merge branch '${from}' into ${target.branch}`,
      chips: [
        { label: target.branch, kind: "ref-local" as const },
        ...(target.tag ? [{ label: target.tag, kind: "ref-tag" as const }] : []),
      ],
    })),
    {
      key: "branch",
      subject: `Latest commit on ${from}`,
      chips: [{ label: from, kind: "ref-local" as const }],
    },
  ];

  return { graph, rows };
}
