/** The order repository tabs sit in.
 *
 *  The backend lists repositories alphabetically, which is a reasonable default
 *  and a poor arrangement: tabs are a place you build a habit about, and the
 *  habit is spatial. So the order lives here, as a list of ids, and the
 *  alphabetical list only decides which repositories exist.
 */

/** Sort `items` by `order`, keeping anything unlisted at the end.
 *
 *  Unlisted means newly opened — it has no place yet, and the end is where a
 *  new tab appears in every application that has tabs. Ids in `order` that no
 *  longer exist are ignored rather than leaving holes, so closing a repository
 *  and reopening it later cannot resurrect a gap.
 */
export function applyOrder<T>(items: T[], order: string[], idOf: (item: T) => string): T[] {
  const byId = new Map(items.map((item) => [idOf(item), item]));
  const placed: T[] = [];
  const seen = new Set<string>();

  for (const id of order) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      placed.push(item);
      seen.add(id);
    }
  }

  return [...placed, ...items.filter((item) => !seen.has(idOf(item)))];
}

/**
 * Move the item at `from` so that it sits at `to`.
 *
 * Both indices are positions in the list as it currently reads, which is what
 * a drag reports: the tab under the pointer is the place it should end up.
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(from, 1);
  // `moved` cannot be undefined given the bounds check above, but splice's
  // type does not know that.
  if (moved !== undefined) next.splice(to, 0, moved);

  return next;
}

/**
 * Which position a dragged tab would land in, given how far it has travelled.
 *
 * The test is the *leading* edge against a neighbour's centre — the left edge
 * when moving left, the right edge when moving right — rather than the dragged
 * tab's own centre.
 *
 * Its centre cannot do the job. Held against the far left, a tab's centre sits
 * half its own width into the strip, so it only gets past the first tab's
 * centre when it happens to be the narrower of the two: a long repository name
 * could never be dragged in front of a short one. A leading edge reaches the
 * end of its travel whatever the widths are.
 */
export function landingIndex(
  lefts: number[],
  widths: number[],
  from: number,
  dx: number,
): number {
  if (from < 0 || from >= lefts.length) return from;

  const left = lefts[from]! + dx;
  const right = left + widths[from]!;
  const centreOf = (i: number) => lefts[i]! + widths[i]! / 2;

  let to = from;

  // One direction per move, so the two tests can never argue.
  if (dx > 0) {
    while (to < lefts.length - 1 && right > centreOf(to + 1)) to++;
  } else if (dx < 0) {
    while (to > 0 && left < centreOf(to - 1)) to--;
  }

  return to;
}
