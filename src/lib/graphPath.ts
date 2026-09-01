/** The shape of one link in the commit graph.
 *
 *  Kept apart from the component so it can be reasoned about — and drawn into a
 *  file and looked at — without rendering React.
 */

/** How far a lane change is allowed to ease before it commits to moving.
 *
 *  A merge whose parent is eight lanes away has to cross about a hundred pixels
 *  inside half a row, and a symmetric cubic spends that budget flattening out:
 *  the line leaves its lane, immediately turns horizontal, and arrives as a
 *  plateau with two right angles. Holding the ease to a fixed distance instead
 *  means a long move reads as a diagonal that straightens at each end, and a
 *  short one still reads as the gentle S it always did.
 */
const EASE = 9;

/**
 * A path from (x1, y1) to (x2, y2), leaving and arriving vertically.
 *
 * Vertical at both ends is what makes a lane continuous across rows: each row
 * draws only its own cell, so a link has to meet the row above and below at a
 * tangent or the column visibly kinks at every boundary.
 */
export function linkPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;

  // Never more than half the height, or the two eases would overlap and the
  // curve would double back on itself.
  const ease = Math.min(EASE, Math.abs(y2 - y1) / 2);
  const direction = y2 > y1 ? 1 : -1;

  const c1 = y1 + ease * direction;
  const c2 = y2 - ease * direction;

  return `M ${x1} ${y1} C ${x1} ${c1}, ${x2} ${c2}, ${x2} ${y2}`;
}

/** The x of a lane's centre, held inside the column.
 *
 *  The graph is capped at a number of lanes so it cannot eat the description
 *  beside it, but a busy repository has more lanes than the cap. Those still
 *  have links, and drawing them at their true position puts them outside the
 *  column entirely — over the commit subjects, which is what `overflow:
 *  visible` used to allow.
 *
 *  Clamping instead collapses everything past the cap onto the last column.
 *  Lines there overlap, which is honest: it says there is more history to the
 *  right than fits, rather than drawing a line that stops in the middle of a
 *  word.
 */
export function laneX(lane: number, lanes: number, laneWidth: number): number {
  const last = Math.max(lanes - 1, 0);
  return Math.min(Math.max(lane, 0), last) * laneWidth + laneWidth / 2;
}
