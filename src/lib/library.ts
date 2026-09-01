/** The repositories the user has added, open or not.
 *
 *  A tab is a view of one of these, not the thing itself. Closing a tab is
 *  putting a book back on the shelf; removing an entry here is the thing that
 *  forgets it.
 */

/** The id of the repository-list tab.
 *
 *  A tab rather than a panel over one, so it closes the way everything else in
 *  the strip closes. Not a path, and never one: a repository is identified by
 *  its root, and no root looks like this. */
export const LIBRARY_TAB = "braid://repositories";

export interface Bookmark {
  /** Worktree root, and the identity. */
  path: string;
  /** What to call it, or empty to use the folder's own name. */
  name: string;
}

/** Paths compare case-insensitively on Windows and by separator nowhere.
 *
 *  The backend already normalizes a repository id this way; the same rule has
 *  to hold here or `E:/Projects/api` and `E:\Projects\API` become two entries
 *  for one repository. */
export const samePath = (a: string, b: string) =>
  a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

/** The name to show: the chosen one, or the folder's. */
export function displayName(bookmark: Bookmark): string {
  const chosen = bookmark.name.trim();
  if (chosen !== "") return chosen;

  const parts = bookmark.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || bookmark.path;
}

/** Add a repository, or leave the list alone if it is already there.
 *
 *  Opening a repository you already have must not add a second entry, and must
 *  not overwrite the name you gave it. */
export function remember(list: Bookmark[], path: string, name = ""): Bookmark[] {
  return list.some((entry) => samePath(entry.path, path))
    ? list
    : [...list, { path, name }];
}

export function forget(list: Bookmark[], path: string): Bookmark[] {
  return list.filter((entry) => !samePath(entry.path, path));
}

/** Rename an entry. An empty name means "go back to the folder's own". */
export function rename(list: Bookmark[], path: string, name: string): Bookmark[] {
  return list.map((entry) =>
    samePath(entry.path, path) ? { ...entry, name: name.trim() } : entry,
  );
}

/** Point an entry at a different folder, for a repository that has moved.
 *
 *  Moving one onto a path already in the list would leave two entries for one
 *  repository, so the move is refused rather than silently making a duplicate.
 */
export function relocate(list: Bookmark[], from: string, to: string): Bookmark[] {
  const target = to.trim();
  if (target === "" || samePath(from, target)) return list;
  if (list.some((entry) => samePath(entry.path, target))) return list;

  return list.map((entry) =>
    samePath(entry.path, from) ? { ...entry, path: target } : entry,
  );
}

/** Change an entry's name and folder together.
 *
 *  One operation rather than a rename followed by a move, because they are one
 *  edit: applying half of it -- the new name onto the old folder -- is a state
 *  the user never asked for and would have to undo.
 *
 *  Returns the list untouched when the new folder is already listed. Two
 *  entries for one repository is the thing the whole list is keyed to avoid,
 *  and the caller can see it happened by the list coming back unchanged. */
export function edit(
  list: Bookmark[],
  from: string,
  next: { path: string; name: string },
): Bookmark[] {
  const target = next.path.trim() === "" ? from : next.path.trim();
  const moving = !samePath(target, from);

  if (moving && list.some((entry) => samePath(entry.path, target))) return list;

  return list.map((entry) =>
    samePath(entry.path, from) ? { path: target, name: next.name.trim() } : entry,
  );
}

/** Find an entry by path. */
export const find = (list: Bookmark[], path: string) =>
  list.find((entry) => samePath(entry.path, path));
