import type { DiffLine } from "./api";

/** One line of a hunk, with its position in the hunk kept, because that is
 *  what staging by line refers to. */
export interface Placed {
  index: number;
  line: DiffLine;
}

/** A row of a side-by-side diff: what was there on the left, what is there
 *  now on the right. Either side can be empty. */
export interface SplitRow {
  left?: Placed;
  right?: Placed;
}

/** Lay a hunk out in two columns.
 *
 *  A context line sits on both sides. A run of removed lines followed by a
 *  run of added lines is a change, and the two runs are shown beside each
 *  other, line for line, with whichever is longer running on alone. */
export function pairLines(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.kind === "removed") {
      const removed: Placed[] = [];
      while (i < lines.length && lines[i]!.kind === "removed") {
        removed.push({ index: i, line: lines[i]! });
        i++;
      }
      const added: Placed[] = [];
      while (i < lines.length && lines[i]!.kind === "added") {
        added.push({ index: i, line: lines[i]! });
        i++;
      }
      for (let n = 0; n < Math.max(removed.length, added.length); n++) {
        rows.push({ left: removed[n], right: added[n] });
      }
      continue;
    }

    if (line.kind === "added") {
      rows.push({ right: { index: i, line } });
    } else {
      rows.push({ left: { index: i, line }, right: { index: i, line } });
    }
    i++;
  }

  return rows;
}
