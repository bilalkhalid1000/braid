/** Commit graph lane assignment.
 *
 *  History is a list of commits, but what a person reads is the shape of the
 *  branching. This turns the flat list into lanes and the links between them,
 *  which is the one thing a git client is remembered by.
 *
 *  The input must be ordered so that no parent appears before all of its
 *  children — `git log --date-order` guarantees that. Without it, a commit
 *  could arrive before the lane reserved for it exists and the graph would
 *  fork where it should join.
 */

export interface GraphLink {
  /** Lane index at the top of the half-cell. */
  from: number;
  /** Lane index at the bottom of the half-cell. */
  to: number;
  color: number;
}

export interface GraphRow {
  /** Lane the commit's node sits in. */
  lane: number;
  color: number;
  isMerge: boolean;
  /** Links occupying the upper half of the row: top edge to the node. */
  up: GraphLink[];
  /** Links occupying the lower half: the node to the bottom edge. */
  down: GraphLink[];
}

export interface Graph {
  rows: GraphRow[];
  /** Widest point of the whole graph, used to size the column once rather
   *  than reflowing it as the user scrolls. */
  maxLanes: number;
}

export interface GraphCommit {
  oid: string;
  parents: string[];
}

export function buildGraph(commits: GraphCommit[]): Graph {
  /** What each lane slot is waiting to draw next. `null` means free. */
  const lanes: (string | null)[] = [];
  /** Colors are per lane occupancy, not per slot: a reused slot gets a fresh
   *  color so two unrelated branches never share one. */
  const colors: number[] = [];

  const rows: GraphRow[] = [];
  let nextColor = 0;
  let maxLanes = 1;

  for (const commit of commits) {
    // Lanes already reserved for this commit by children seen earlier.
    const waiting: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.oid) waiting.push(i);
    }

    // The leftmost claim wins; the rest are branches merging into this node.
    let lane: number;
    if (waiting.length > 0) {
      lane = waiting[0];
    } else {
      // A commit nothing points at: a branch tip, so it starts a new lane.
      lane = firstFree(lanes);
      lanes[lane] = commit.oid;
      colors[lane] = nextColor++;
    }

    const up: GraphLink[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) continue;
      // Claimed lanes converge on the node; everything else passes straight by.
      const to = waiting.includes(i) ? lane : i;
      up.push({ from: i, to, color: colors[i] });
    }

    for (const index of waiting) {
      if (index !== lane) lanes[index] = null;
    }

    // The first parent continues in this lane, so a branch keeps its column
    // for its whole life instead of drifting left as neighbours close.
    lanes[lane] = commit.parents[0] ?? null;

    const extraLanes: number[] = [];
    const opened = new Set<number>();

    for (const parent of commit.parents.slice(1)) {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = firstFree(lanes);
        lanes[target] = parent;
        colors[target] = nextColor++;
        opened.add(target);
      }
      extraLanes.push(target);
    }

    const down: GraphLink[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) continue;
      // A lane opened for this commit's parent starts at the node, not above.
      if (opened.has(i)) continue;
      down.push({ from: i, to: i, color: colors[i] });
    }

    for (const target of extraLanes) {
      down.push({ from: lane, to: target, color: colors[target] });
    }

    trimTrailing(lanes);

    const width = 1 + Math.max(lane, ...up.flatMap((l) => [l.from, l.to]), ...down.flatMap((l) => [l.from, l.to]));
    maxLanes = Math.max(maxLanes, width);

    rows.push({
      lane,
      color: colors[lane],
      isMerge: commit.parents.length > 1,
      up,
      down,
    });
  }

  return { rows, maxLanes };
}

function firstFree(lanes: (string | null)[]): number {
  const free = lanes.indexOf(null);
  return free === -1 ? lanes.length : free;
}

/** Keep the lane array from growing forever once branches close on the right. */
function trimTrailing(lanes: (string | null)[]) {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
}
