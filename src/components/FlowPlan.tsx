import { planFinish, type FlowPlanTarget } from "../lib/flowPlan";
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
  const { graph, rows } = planFinish(from, targets);
  const lanes = Math.max(graph.maxLanes, 1);

  return (
    <div
      className="my-4 overflow-hidden rounded-sm border border-border bg-surface-alt py-2"
      role="img"
      aria-label={`Merges ${from} into ${targets.map((target) => target.branch).join(" and ")}`}
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
          />

          <span className="min-w-0 flex-1 truncate text-small">
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
