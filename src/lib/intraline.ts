import type { DiffLine } from "./api";

/** A stretch of a line that differs from its counterpart, as character
 *  offsets: `[start, end)`. */
export interface Range {
  start: number;
  end: number;
}

/** The changed stretches of each line in a hunk, by the line's index in it.
 *  A line with no entry is either context or a change too large to say
 *  anything useful about, and is drawn whole. */
export type Marks = Map<number, Range[]>;

/** Past this many token comparisons a pair is left unmarked. The table is
 *  n × m; a pair of 200-token lines is 40,000 cells, which is nothing, but a
 *  minified line against another is millions and would stall the render for
 *  a result nobody could read anyway. */
const MAX_CELLS = 250_000;

/** How much of a line may have changed before the marks say less than the
 *  colour already does. Past this the whole line is treated as replaced:
 *  marking three words that happen to survive a rewrite draws the eye to the
 *  wrong thing. */
const MAX_CHANGED = 0.65;

/** Words, runs of spaces, and single punctuation marks. A token is the unit
 *  the marks are drawn in, so a changed identifier lights up whole rather
 *  than letter by letter -- which is what a person comparing the two lines
 *  would say changed. */
const TOKEN = /\w+|\s+|[^\w\s]/g;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** The tokens of `a` and `b` that are not part of a longest common
 *  subsequence, as character ranges into each. */
export function diffTokens(a: string, b: string): { a: Range[]; b: Range[] } | null {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length * tb.length > MAX_CELLS) return null;

  // The classic table, one row per token of `a`. Small enough to be flat.
  const cols = tb.length + 1;
  const table = new Uint16Array((ta.length + 1) * cols);
  for (let i = ta.length - 1; i >= 0; i--) {
    for (let j = tb.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        ta[i] === tb[j]
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }

  // Walk it, keeping every token that is not on the common path.
  const keepA = new Array<boolean>(ta.length).fill(true);
  const keepB = new Array<boolean>(tb.length).fill(true);
  let i = 0;
  let j = 0;
  while (i < ta.length && j < tb.length) {
    if (ta[i] === tb[j]) {
      keepA[i] = false;
      keepB[j] = false;
      i++;
      j++;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      i++;
    } else {
      j++;
    }
  }

  return { a: ranges(ta, keepA), b: ranges(tb, keepB) };
}

/** Adjacent changed tokens become one range, so a changed phrase is one
 *  mark rather than a word and a space and a word. */
function ranges(tokens: string[], changed: boolean[]): Range[] {
  const out: Range[] = [];
  let at = 0;
  for (let n = 0; n < tokens.length; n++) {
    const end = at + tokens[n]!.length;
    if (changed[n]) {
      const last = out[out.length - 1];
      if (last && last.end === at) last.end = end;
      else out.push({ start: at, end });
    }
    at = end;
  }
  return out;
}

const span = (marks: Range[]) => marks.reduce((sum, r) => sum + r.end - r.start, 0);

/** Marks for one hunk.
 *
 *  A run of removed lines followed by a run of added lines is a change, and
 *  the two runs are compared line for line, the same pairing the side-by-side
 *  view draws. A run with no counterpart -- a pure insertion, a pure
 *  deletion -- has nothing to compare against and stays unmarked. */
export function markHunk(lines: DiffLine[]): Marks {
  const marks: Marks = new Map();
  let i = 0;

  while (i < lines.length) {
    if (lines[i]!.kind !== "removed") {
      i++;
      continue;
    }

    const removed: number[] = [];
    while (i < lines.length && lines[i]!.kind === "removed") removed.push(i++);
    const added: number[] = [];
    while (i < lines.length && lines[i]!.kind === "added") added.push(i++);

    for (let n = 0; n < Math.min(removed.length, added.length); n++) {
      const old = lines[removed[n]!]!.content;
      const now = lines[added[n]!]!.content;
      if (old === now) continue;

      const result = diffTokens(old, now);
      if (!result) continue;

      // Both sides have to survive the test: a short line rewritten into a
      // long one is a rewrite, whichever side you measure.
      const changedA = old.length === 0 ? 1 : span(result.a) / old.length;
      const changedB = now.length === 0 ? 1 : span(result.b) / now.length;
      if (changedA > MAX_CHANGED || changedB > MAX_CHANGED) continue;

      if (result.a.length > 0) marks.set(removed[n]!, result.a);
      if (result.b.length > 0) marks.set(added[n]!, result.b);
    }
  }

  return marks;
}
