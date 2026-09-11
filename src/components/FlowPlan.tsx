import { useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import { planFinish, planStart, type FlowPlanTarget, type PlanRow } from "../lib/flowPlan";
import type { Graph } from "../lib/graph";
import { CommitGraph } from "./CommitGraph";

export type { FlowPlanTarget };

interface Props {
  /** The branch the work is coming from. */
  from: string;
  targets: FlowPlanTarget[];
}

/** Same as the history view's, so the preview and the thing it predicts are
 *  drawn at one scale. */
const ROW_HEIGHT = 26;

/** What a git flow action is about to do, drawn as the history it will leave.
 *
 *  The prose version -- "merges this into main, tags it, then merges it into
 *  develop" -- is a sentence you have to hold in your head to check. The arrow
 *  diagram this replaces was not much better: it named the branches but not
 *  the result, so it could not answer the question people actually open this
 *  dialog with, which is where the tag ends up.
 *
 *  The commits are handed to the same graph the history view uses. The lanes,
 *  the merge rings and the ref chips are the real ones, so the preview can be
 *  held against the history afterwards.
 */
export function FlowPlan({ from, targets }: Props) {
  const plan = planFinish(from, targets);

  return (
    <PlanGraph
      plan={plan}
      label={`Merges ${from} into ${targets.map((target) => target.branch).join(" and ")}`}
    />
  );
}

/** What a git flow start will make: the branch, on top of where it is cut
 *  from. The base's latest commit is read so the preview shows the real
 *  thing you are about to branch off rather than a placeholder for it. */
export function FlowStartPlan({
  repoId,
  branch,
  base,
  /** The base's tip, when it is a local branch and so known. */
  baseOid,
}: {
  repoId: string;
  branch: string;
  base: string;
  baseOid: string | null;
}) {
  const tip = useQuery({
    queryKey: ["commit", repoId, baseOid],
    queryFn: () => api.commitDetail(repoId, baseOid!),
    enabled: baseOid !== null,
    staleTime: Infinity,
  });

  const subject = tip.data?.subject ?? `Latest commit on ${base}`;
  const plan = planStart(branch, base, subject);

  return <PlanGraph plan={plan} label={`Creates ${branch} from ${base}`} />;
}

function PlanGraph({ plan, label }: { plan: { graph: Graph; rows: PlanRow[] }; label: string }) {
  const { graph, rows } = plan;
  const lanes = Math.max(graph.maxLanes, 1);

  return (
    // flow-preview is what animates it: the lines draw themselves outward
    // from the trunk when the preview appears. Once, on mount -- the rows
    // keep their keys as the name is typed, so a keystroke changes a chip
    // without redrawing the graph.
    <div
      className="flow-preview my-4 overflow-hidden rounded-sm border border-border bg-surface-alt py-2"
      role="img"
      aria-label={label}
    >
      {rows.map((row, index) => (
        <div
          key={row.key}
          className="flex items-center gap-3 px-3"
          style={{ height: ROW_HEIGHT }}
        >
          <CommitGraph
            row={graph.rows[index]!}
            lanes={lanes}
            height={ROW_HEIGHT}
            isHead={false}
            ghost={row.ghost}
          />

          <span className={`min-w-0 flex-1 truncate text-small ${row.ghost ? "text-text-faint" : ""}`}>
            {row.chips.map((chip) => (
              <span key={chip.label} className={`ref-chip ${chip.kind}`}>
                {chip.label}
              </span>
            ))}
            <span className="text-text-dim">{row.subject}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
