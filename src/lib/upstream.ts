/** Reading a tracking ref.
 *
 *  An upstream is written `origin/feature/login`: the remote, then the branch
 *  as that remote calls it. Splitting it matters because the two names need not
 *  match — a local `fix` can track `origin/hotfix/thing` — and deleting the
 *  wrong one is not something git asks about twice.
 */

export interface Upstream {
  remote: string;
  /** The branch's name on the remote, which is not always its name here. */
  branch: string;
}

/** Split a tracking ref into the remote and the branch on it.
 *
 *  Only the first slash separates them: a remote name cannot contain one, and
 *  a branch name very often does.
 */
export function splitUpstream(upstream: string | null | undefined): Upstream | null {
  if (!upstream) return null;

  const cut = upstream.indexOf("/");
  if (cut <= 0) return null;

  const remote = upstream.slice(0, cut);
  const branch = upstream.slice(cut + 1);

  return branch === "" ? null : { remote, branch };
}
