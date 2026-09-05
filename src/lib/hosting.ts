/** Where a remote lives on the web, worked out from its URL.
 *
 *  Covers the forms git accepts -- scp-like, ssh://, https://, git:// --
 *  and the three hosts whose page layouts differ. Anything else is assumed
 *  to lay its pages out like GitHub, which most self-hosted forges do. */

export type Provider = "github" | "gitlab" | "bitbucket" | "generic";

export interface Hosting {
  provider: Provider;
  /** "GitHub", "GitLab", "Bitbucket", or the host name. */
  name: string;
  /** The repository's page, no trailing slash. */
  web: string;
}

export function hostingOf(remoteUrl: string): Hosting | null {
  const url = remoteUrl.trim();
  if (!url) return null;

  let host: string | undefined;
  let path: string | undefined;

  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(url);
  const full = /^(?:ssh|https?|git)(?:\+ssh)?:\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/(.+)$/.exec(url);

  if (full) {
    host = full[1];
    path = full[2];
  } else if (scp) {
    host = scp[1];
    path = scp[2];
  }
  if (!host || !path) return null;

  path = path.replace(/\/+$/, "").replace(/\.git$/, "").replace(/^\/+/, "");
  if (!path.includes("/")) return null;

  const provider: Provider =
    host === "github.com"
      ? "github"
      : host.includes("gitlab")
        ? "gitlab"
        : host === "bitbucket.org"
          ? "bitbucket"
          : "generic";

  const name =
    provider === "github"
      ? "GitHub"
      : provider === "gitlab"
        ? "GitLab"
        : provider === "bitbucket"
          ? "Bitbucket"
          : host;

  return { provider, name, web: `https://${host}/${path}` };
}

export function commitUrl(hosting: Hosting, oid: string): string {
  switch (hosting.provider) {
    case "gitlab":
      return `${hosting.web}/-/commit/${oid}`;
    case "bitbucket":
      return `${hosting.web}/commits/${oid}`;
    default:
      return `${hosting.web}/commit/${oid}`;
  }
}

export function branchUrl(hosting: Hosting, branch: string): string {
  const name = encodeURIComponent(branch).replace(/%2F/g, "/");
  switch (hosting.provider) {
    case "gitlab":
      return `${hosting.web}/-/tree/${name}`;
    case "bitbucket":
      return `${hosting.web}/branch/${name}`;
    default:
      return `${hosting.web}/tree/${name}`;
  }
}

/** The page that starts a pull request from a branch. */
export function newPullRequestUrl(hosting: Hosting, branch: string): string {
  const name = encodeURIComponent(branch);
  switch (hosting.provider) {
    case "gitlab":
      return `${hosting.web}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${name}`;
    case "bitbucket":
      return `${hosting.web}/pull-requests/new?source=${name}`;
    default:
      return `${hosting.web}/compare/${name.replace(/%2F/g, "/")}?expand=1`;
  }
}

export function pullRequestsUrl(hosting: Hosting): string {
  switch (hosting.provider) {
    case "gitlab":
      return `${hosting.web}/-/merge_requests`;
    case "bitbucket":
      return `${hosting.web}/pull-requests`;
    default:
      return `${hosting.web}/pulls`;
  }
}

/** What a pull request is called there. */
export const pullRequestNoun = (hosting: Hosting) =>
  hosting.provider === "gitlab" ? "merge request" : "pull request";
