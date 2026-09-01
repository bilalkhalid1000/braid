import { describe, expect, it } from "vitest";

import { cloneDestination, repoNameFromUrl } from "./cloneTarget";

describe("repoNameFromUrl", () => {
  it("takes the last segment of an https URL", () => {
    expect(repoNameFromUrl("https://github.com/owner/repo.git")).toBe("repo");
    expect(repoNameFromUrl("https://github.com/owner/repo")).toBe("repo");
  });

  it("handles the scp form, which has no scheme to parse", () => {
    // `git@host:owner/repo.git` is not a URL. Splitting on "/" alone would
    // work here by luck, but "git@host:repo.git" has no slash at all.
    expect(repoNameFromUrl("git@github.com:owner/repo.git")).toBe("repo");
    expect(repoNameFromUrl("git@github.com:repo.git")).toBe("repo");
  });

  it("ignores a trailing slash", () => {
    expect(repoNameFromUrl("https://github.com/owner/repo/")).toBe("repo");
    expect(repoNameFromUrl("https://github.com/owner/repo.git/")).toBe("repo");
  });

  it("ignores a query or fragment", () => {
    expect(repoNameFromUrl("https://host/owner/repo.git?ref=main")).toBe("repo");
    expect(repoNameFromUrl("https://host/owner/repo#readme")).toBe("repo");
  });

  it("strips .git only at the end, and only once", () => {
    // A repository legitimately called "repo.github" keeps its name.
    expect(repoNameFromUrl("https://host/owner/repo.github")).toBe("repo.github");
    expect(repoNameFromUrl("https://host/owner/my.git.repo.git")).toBe("my.git.repo");
  });

  it("reads ssh:// and file:// the same way", () => {
    expect(repoNameFromUrl("ssh://git@host:22/owner/repo.git")).toBe("repo");
    expect(repoNameFromUrl("file:///srv/git/repo.git")).toBe("repo");
  });

  it("handles a local path", () => {
    expect(repoNameFromUrl("/srv/git/repo.git")).toBe("repo");
  });

  it("is null when there is nothing to take", () => {
    expect(repoNameFromUrl("")).toBeNull();
    expect(repoNameFromUrl("   ")).toBeNull();
    expect(repoNameFromUrl("https://github.com/")).toBeNull();
    expect(repoNameFromUrl(".git")).toBeNull();
  });

  it("is case insensitive about the suffix", () => {
    expect(repoNameFromUrl("https://host/owner/repo.GIT")).toBe("repo");
  });
});

describe("cloneDestination", () => {
  it("joins the parent and the name", () => {
    expect(cloneDestination("E:/Projects", "repo")).toBe("E:/Projects/repo");
  });

  it("does not double the separator", () => {
    expect(cloneDestination("E:/Projects/", "repo")).toBe("E:/Projects/repo");
    expect(cloneDestination("E:\\Projects\\", "repo")).toBe("E:\\Projects/repo");
  });

  it("trims what the user pasted", () => {
    expect(cloneDestination("  E:/Projects  ", "  repo  ")).toBe("E:/Projects/repo");
  });
});
