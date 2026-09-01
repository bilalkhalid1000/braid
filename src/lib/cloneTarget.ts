/** Working out where a clone should land.
 *
 *  Nobody types the folder name — it is in the URL, and `git clone` derives it
 *  the same way. Getting it wrong is not cosmetic: it decides which directory
 *  gets created and then opened as a tab.
 */

/** The folder `git clone <url>` would create, or null if the URL says nothing.
 *
 *  Handles the two shapes git accepts: a real URL, and the scp-like
 *  `git@host:owner/repo.git` that has no scheme and so cannot be parsed as one.
 */
export function repoNameFromUrl(url: string): string | null {
  let text = url.trim();
  if (text === "") return null;

  // A query or fragment is not part of the path, and would otherwise end up
  // in the folder name.
  text = text.split(/[?#]/)[0]!;

  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

  if (scheme.test(text)) {
    // Drop the scheme and the authority together. The host is not the
    // repository: without this, "https://github.com/" yields "github.com".
    const rest = text.replace(scheme, "");
    const cut = rest.indexOf("/");
    text = cut === -1 ? "" : rest.slice(cut + 1);
  } else {
    // The scp form, git@host:path, has no scheme to strip and puts the path
    // after a colon. Only when nothing before that colon looks like a path,
    // so a Windows drive letter is not mistaken for a host.
    const colon = text.indexOf(":");
    if (colon !== -1 && !text.slice(0, colon).includes("/")) {
      text = text.slice(colon + 1);
    }
  }

  const segments = text.split("/").filter((part) => part !== "");
  const last = segments[segments.length - 1];
  if (!last) return null;

  // Only at the end, and only once: a repository called "repo.github" keeps
  // its name.
  const name = last.replace(/\.git$/i, "");

  return name === "" || name === "." || name === ".." ? null : name;
}

/** Join a parent directory and a folder name into the path to clone into. */
export function cloneDestination(parent: string, name: string): string {
  return `${parent.trim().replace(/[\\/]+$/, "")}/${name.trim()}`;
}
