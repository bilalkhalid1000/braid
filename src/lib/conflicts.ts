/** The index of the next conflicted row after `from` in `delta`'s direction,
 *  wrapping around, or -1 when none is. From -1, the search starts at an end. */
export function nextConflict(kinds: string[], from: number, delta: 1 | -1): number {
  const n = kinds.length;
  if (n === 0) return -1;

  let i = from;
  for (let step = 0; step < n; step++) {
    i = (((i + delta) % n) + n) % n;
    if (kinds[i] === "unmerged") return i;
  }
  return -1;
}
