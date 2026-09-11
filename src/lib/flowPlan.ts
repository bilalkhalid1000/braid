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
  /** Not a commit: where the base branch goes on, above and below what is
   *  shown. Drawn hollow and faint. */
  ghost?: boolean;
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

/** The history a git flow start will leave behind: the new branch, one
 *  commit up from the tip of the branch it is cut from.
 *
 *  What SourceTree draws in its start dialog, and for the same reason: the
 *  name typed above turns into a branch chip on a graph, so a space or a
 *  doubled prefix is seen before it is made. The base's own lane runs off
 *  the bottom, as it does in the finish preview -- there is history below. */
export function planStart(
  branch: string,
  base: string,
  baseSubject: string,
): { graph: Graph; rows: PlanRow[] } {
  // The base's own future comes first, so it takes the first lane and the
  // new branch is pushed out to the side -- which is the whole picture: a
  // branch is a step off the trunk, not the trunk. Both ghosts are the base
  // carrying on, above and below the two commits that matter.
  const graph = buildGraph([
    { oid: "ahead", parents: ["tip"] },
    { oid: "new", parents: ["tip"] },
    { oid: "tip", parents: ["older"] },
    { oid: "older", parents: ["oldest"] },
  ]);

  const rows: PlanRow[] = [
    { key: "ahead", subject: "", chips: [], ghost: true },
    {
      key: "new",
      subject: "Create new branch",
      chips: [{ label: branch, kind: "ref-local" }],
    },
    {
      key: "tip",
      subject: baseSubject,
      chips: [{ label: base, kind: "ref-local" }],
    },
    { key: "older", subject: "\u2026", chips: [], ghost: true },
  ];

  return { graph, rows };
}
