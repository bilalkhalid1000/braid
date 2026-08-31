export interface FlowPlanTarget {
  branch: string;
  /** Anything that happens on arrival — a tag, usually. */
  note?: string;
}

interface Props {
  /** The branch the work is coming from. */
  from: string;
  targets: FlowPlanTarget[];
  /** Set when `from` is the branch being created rather than merged away. */
  creating?: boolean;
}

const ROW = 34;
const TOP = 14;
const RAIL = 11;
const TARGET_X = 43;

/** What a git flow action is about to do, drawn.
 *
 *  The prose version — "merges this into main, tags it, then merges it into
 *  develop" — is a sentence you have to hold in your head to check. Two merges,
 *  a tag and a delete is exactly the kind of thing worth seeing before pressing
 *  a button, which is the one place SourceTree is genuinely clearer.
 */
export function FlowPlan({ from, targets, creating }: Props) {
  const height = TOP + ROW * targets.length + 10;
  const lastY = TOP + ROW * targets.length;

  const summary = creating
    ? `Creates ${targets.map((t) => t.branch).join(" and ")} from ${from}`
    : `Merges ${from} into ${targets.map((t) => t.branch).join(" and ")}`;

  return (
    <svg
      className="flow-plan"
      viewBox={`0 0 300 ${height}`}
      height={height}
      role="img"
      aria-label={summary}
    >
      <defs>
        <marker
          id="flow-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M 0 1 L 7 4 L 0 7 z" className="flow-arrow-head" />
        </marker>
      </defs>

      {/* The trunk the arrows leave from. */}
      <line className="flow-rail" x1={RAIL} y1={TOP} x2={RAIL} y2={lastY} />

      <circle className="flow-node flow-node-source" cx={RAIL} cy={TOP} r="4" />
      <text className="flow-branch" x={RAIL + 14} y={TOP + 4}>
        {from}
      </text>

      {targets.map((target, index) => {
        const y = TOP + ROW * (index + 1);

        return (
          <g key={target.branch}>
            <line
              className="flow-rail"
              x1={RAIL}
              y1={y}
              x2={TARGET_X - 10}
              y2={y}
              markerEnd="url(#flow-arrow)"
            />
            <circle className="flow-node" cx={TARGET_X} cy={y} r="4" />
            <text className="flow-branch" x={TARGET_X + 12} y={y + 4}>
              {target.branch}
              {/* A tspan flows after the label, so the note never needs its
                  width guessed at from the character count. */}
              {target.note && (
                <tspan className="flow-note" dx="10">
                  {target.note}
                </tspan>
              )}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
