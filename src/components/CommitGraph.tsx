import { memo } from "react";

import type { GraphLink, GraphRow } from "../lib/graph";

export const LANE_WIDTH = 13;
const NODE_RADIUS = 3.5;

/** Lane colors.
 *
 *  Eight hues at even spacing and matched chroma, so no lane reads as more
 *  important than another. Deliberately avoids the red and green the diff view
 *  uses for deletions and additions: a lane is a place, not a verdict. */
const LANE_COLORS = [
  "#3d7dfa",
  "#8b5cf6",
  "#d946a6",
  "#e08a1e",
  "#1aa06d",
  "#0f9bb5",
  "#5b6ee8",
  "#c2536b",
];

export const laneColor = (index: number) => LANE_COLORS[index % LANE_COLORS.length];

interface Props {
  row: GraphRow;
  lanes: number;
  height: number;
  /** Drawn as a filled ring rather than a dot, marking where HEAD sits. */
  isHead: boolean;
}

/** One row of the commit graph.
 *
 *  Each row draws only its own cell: the links entering from above meet the
 *  node at the vertical centre, and the links leaving continue to the bottom
 *  edge, where the next row picks them up. Rows therefore stay independent,
 *  which is what lets the list stay virtualized. */
export const CommitGraph = memo(function CommitGraph({ row, lanes, height, isHead }: Props) {
  const width = Math.max(lanes, 1) * LANE_WIDTH;
  const middle = height / 2;
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;

  return (
    <svg className="graph" width={width} height={height} aria-hidden="true">
      {row.up.map((link, i) => (
        <path
          key={`u${i}`}
          d={curve(x(link.from), 0, x(link.to), middle)}
          stroke={laneColor(link.color)}
          fill="none"
          strokeWidth={1.5}
        />
      ))}

      {row.down.map((link, i) => (
        <path
          key={`d${i}`}
          d={curve(x(link.from), middle, x(link.to), height)}
          stroke={laneColor(link.color)}
          fill="none"
          strokeWidth={1.5}
        />
      ))}

      <circle
        cx={x(row.lane)}
        cy={middle}
        r={isHead ? NODE_RADIUS + 1.5 : NODE_RADIUS}
        // A merge is hollow: it is a join, not a new piece of work.
        fill={row.isMerge ? "var(--surface)" : laneColor(row.color)}
        stroke={laneColor(row.color)}
        strokeWidth={row.isMerge || isHead ? 2 : 0}
      />
    </svg>
  );
});

/** Straight where it can be, eased where it has to move. A cubic with its
 *  control points on the vertical keeps the join to the next row tangent, so
 *  a branch reads as one continuous line down the column. */
function curve(x1: number, y1: number, x2: number, y2: number) {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;

  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export type { GraphLink };
