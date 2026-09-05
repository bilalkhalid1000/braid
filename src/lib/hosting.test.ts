import { describe, expect, it } from "vitest";

import { branchUrl, commitUrl, hostingOf, newPullRequestUrl, pullRequestsUrl } from "./hosting";

describe("hostingOf", () => {
  it("reads every URL form git accepts", () => {
    for (const url of [
      "git@github.com:KnockKnockAppLtd/backend.git",
      "ssh://git@github.com/KnockKnockAppLtd/backend.git",
      "https://github.com/KnockKnockAppLtd/backend.git",
      "https://github.com/KnockKnockAppLtd/backend",
      "git://github.com/KnockKnockAppLtd/backend.git",
      "ssh://git@github.com:22/KnockKnockAppLtd/backend.git",
    ]) {
      expect(hostingOf(url), url).toEqual({
        provider: "github",
        name: "GitHub",
        web: "https://github.com/KnockKnockAppLtd/backend",
      });
    }
  });

  it("knows the hosts whose pages differ, and names the rest by host", () => {
    expect(hostingOf("git@gitlab.example.com:team/app.git")?.provider).toBe("gitlab");
    expect(hostingOf("https://bitbucket.org/team/app.git")?.provider).toBe("bitbucket");
    expect(hostingOf("git@git.corp.internal:team/app.git")).toEqual({
      provider: "generic",
      name: "git.corp.internal",
      web: "https://git.corp.internal/team/app",
    });
  });

  it("gives up on what is not a web repository", () => {
    expect(hostingOf("")).toBeNull();
    expect(hostingOf("/srv/git/app.git")).toBeNull();
    expect(hostingOf("git@github.com:noslash")).toBeNull();
  });
});

describe("page urls", () => {
  const github = hostingOf("git@github.com:o/r.git")!;
  const gitlab = hostingOf("https://gitlab.com/o/r.git")!;
  const bitbucket = hostingOf("https://bitbucket.org/o/r.git")!;

  it("points at commits", () => {
    expect(commitUrl(github, "abc")).toBe("https://github.com/o/r/commit/abc");
    expect(commitUrl(gitlab, "abc")).toBe("https://gitlab.com/o/r/-/commit/abc");
    expect(commitUrl(bitbucket, "abc")).toBe("https://bitbucket.org/o/r/commits/abc");
  });

  it("keeps slashes in branch names readable", () => {
    expect(branchUrl(github, "feature/x")).toBe("https://github.com/o/r/tree/feature/x");
    expect(newPullRequestUrl(github, "feature/x")).toBe(
      "https://github.com/o/r/compare/feature/x?expand=1",
    );
    expect(newPullRequestUrl(gitlab, "feature/x")).toBe(
      "https://gitlab.com/o/r/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fx",
    );
    expect(pullRequestsUrl(bitbucket)).toBe("https://bitbucket.org/o/r/pull-requests");
  });
});
