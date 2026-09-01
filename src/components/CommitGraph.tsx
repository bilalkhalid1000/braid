import { memo } from "react";

import type { GraphLink, GraphRow } from "../lib/graph";
import { laneX, linkPath } from "../lib/graphPath";

export const LANE_WIDTH = 13;
const NODE_RADIUS = 3.5;

/** Lane colours.
 *
 *  Checked with a palette validator rather than chosen by eye, because the
 *  question "can these eight be told apart" is answerable and guessing at it
 *  produced a palette where violet and blue sat at ΔE 11 — below the threshold
 *  at which full-colour vision separates them, and ΔE 0.9 under deuteranopia,
 *  which is to say identical.
 *
 *  Lightness alternates rather than staying matched. Constant lightness cannot
 *  reach the separation floor at eight hues, and it is lightness that survives
 *  colour blindness: the deutan worst case here is ΔE 13 against a floor of 8.
 *  The order matters as much as the values — cyan and magenta collapse into
 *  each other for a deutan reader, so they are not neighbours.
 *
 *  Still deliberately away from the red and green the diff view uses for
 *  deletions and additions: a lane is a place, not a verdict.
 */
const LANE_COLORS = [
  "#4d97de",
  "#a74541",
  "#54a863",
  "#7555a8",
  "#ca7e31",
  "#00a6c0",
  "#637200",
  "#ab61a5",
];

export const laneColor = (index: number) => LANE_COLORS[index % LANE_COLORS.length];

/* The gap a lane leaves around itself where it crosses another. It is painted
   the colour of the row rather than a colour of its own, so it has to follow
   the row's state -- hence the group on the row and the variants here. */
const CASING =
  "stroke-surface group-hover:stroke-surface-alt " +
  "group-data-[selected=true]:stroke-select";

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
  const x = (lane: number) => laneX(lane, lanes, LANE_WIDTH);

  /** Lanes that carry straight through first, then the ones that move.
   *
   *  A link that changes lane crosses every lane between, and drawing it last
   *  puts it in front: its casing cuts a gap in each line it passes, which is
   *  the only cue saying which of two crossing lines is which. Drawn the other
   *  way round the connectors would be the ones chopped up, and a merge would
   *  appear to stop halfway. */
  const ordered = (links: GraphLink[]) =>
    [...links].sort(
      (a, b) => Number(a.from !== a.to) - Number(b.from !== b.to),
    );

  const draw = (link: GraphLink, key: string, y1: number, y2: number) => {
    const d = linkPath(x(link.from), y1, x(link.to), y2);

    return (
      <g key={key}>
        <path className={CASING} d={d} fill="none" strokeWidth={4.5} />
        <path d={d} stroke={laneColor(link.color)} fill="none" strokeWidth={1.5} />
      </g>
    );
  };

  return (
    <svg className="graph" width={width} height={height} aria-hidden="true">
      {ordered(row.up).map((link, i) => draw(link, `u${i}`, 0, middle))}
      {ordered(row.down).map((link, i) => draw(link, `d${i}`, middle, height))}

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

export type { GraphLink };
