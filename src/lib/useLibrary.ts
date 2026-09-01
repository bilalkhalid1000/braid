import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import { edit, forget, remember, type Bookmark } from "./library";

/** The repositories the user has added, kept on disk.
 *
 *  Loaded once and written back whenever it changes, like the session — but
 *  deliberately a different file, because closing every tab must not read as
 *  forgetting every repository.
 */
export function useLibrary() {
  const [repos, setRepos] = useState<Bookmark[]>([]);
  /** Nothing is written until the file has been read, or the first change
   *  would save an empty list over a real one. */
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stored = await api.loadLibrary();
        if (!cancelled) setRepos(stored.repos ?? []);
      } finally {
        if (!cancelled) loaded.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const change = useCallback((next: (current: Bookmark[]) => Bookmark[]) => {
    setRepos((current) => {
      const updated = next(current);
      if (updated !== current && loaded.current) void api.saveLibrary(updated);
      return updated;
    });
  }, []);

  return {
    repos,
    /** Add a repository if it is not already listed. */
    add: useCallback(
      (path: string, name = "") => change((list) => remember(list, path, name)),
      [change],
    ),
    remove: useCallback((path: string) => change((list) => forget(list, path)), [change]),
    /** Change a name and a folder together.
     *
     *  Reports whether it took: a move onto a folder already listed is refused,
     *  and the caller is the one that can say so. */
    edit: useCallback(
      (from: string, next: { path: string; name: string }) => {
        let applied = true;
        change((list) => {
          const updated = edit(list, from, next);
          applied = updated !== list;
          return updated;
        });
        return applied;
      },
      [change],
    ),
  };
}
