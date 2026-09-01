import { describe, expect, it } from "vitest";

import { splitUpstream } from "./upstream";

describe("splitUpstream", () => {
  it("splits a plain tracking ref", () => {
    expect(splitUpstream("origin/main")).toEqual({ remote: "origin", branch: "main" });
  });

  it("splits on the first slash only", () => {
    // A remote name cannot contain a slash; a branch name usually does. Getting
    // this backwards would ask git to delete "feature" on a remote called
    // "origin/feature".
    expect(splitUpstream("origin/feature/login")).toEqual({
      remote: "origin",
      branch: "feature/login",
    });
  });

  it("keeps a remote that is not called origin", () => {
    expect(splitUpstream("fork/main")).toEqual({ remote: "fork", branch: "main" });
  });

  it("is null when there is no upstream", () => {
    expect(splitUpstream(null)).toBeNull();
    expect(splitUpstream(undefined)).toBeNull();
    expect(splitUpstream("")).toBeNull();
  });

  it("is null for something that is not a tracking ref", () => {
    expect(splitUpstream("main")).toBeNull();
    expect(splitUpstream("/main")).toBeNull();
    expect(splitUpstream("origin/")).toBeNull();
  });
});
