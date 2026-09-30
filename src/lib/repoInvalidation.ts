import type { Query, QueryClient } from "@tanstack/react-query";

/** Cache keys invalidated when a repo reports that its state changed. */
export const REPO_QUERY_KEYS = [
  "status",
  "refs",
  "log",
  "diff",
  "worktrees",
  "submodules",
  "flow",
  "reflog",
  "bisect",
  // Commits, file contents and paths: all three move with the repository.
  "search",
];

/** Whether a query read something about repository `id` that a change to it
 *  can make wrong. Keyed by commit ("commit", "commitFile") is not, because a
 *  commit never changes. Blame is the same except for the working copy's. */
const readsRepo = (query: Query, id: string) => {
  const [key, repo, , rev] = query.queryKey;
  if (repo !== id || typeof key !== "string") return false;
  return REPO_QUERY_KEYS.includes(key) || (key === "blame" && rev === null);
};

/** Marks everything read from a repository as out of date.
 *
 *  Only what is on screen refetches now; the rest waits until it is looked
 *  at.
 *
 *  A read already running is left to finish and run once more after, rather
 *  than cancelled and restarted, which is react-query's default. History is
 *  several `git log` calls in a row once a few pages are loaded, and in a
 *  repository whose tree is being written to -- a dev server, a build, an
 *  editor saving -- the next change arrived before the last page did. Every
 *  restart threw the work away, so a commit made in the app never reached
 *  the list at all. However many changes land during a read, it costs one
 *  more, and the last one to finish started after all of them.
 */
export function createRepoInvalidator(queryClient: QueryClient) {
  /** Queries that were mid-read when a change arrived, by hash. */
  const rerun = new Set<string>();

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "removed") {
      rerun.delete(event.query.queryHash);
      return;
    }
    if (event.type !== "updated") return;
    if (event.action.type !== "success" && event.action.type !== "error") return;

    const { query } = event;
    if (!rerun.delete(query.queryHash)) return;
    void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
  });

  const invalidate = (id: string) => {
    for (const query of queryClient.getQueryCache().findAll()) {
      if (!readsRepo(query, id)) continue;

      if (query.state.fetchStatus === "fetching") {
        rerun.add(query.queryHash);
      } else {
        void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      }
    }
  };

  return { invalidate, dispose: unsubscribe };
}
