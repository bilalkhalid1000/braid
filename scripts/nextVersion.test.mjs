import { describe, expect, it } from "vitest";

import { VersionError, channelOf, nextVersion } from "./nextVersion.mjs";

describe("nextVersion", () => {
  it("bumps the numbers of a stable version", () => {
    expect(nextVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(nextVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(nextVersion("0.1.9", "major")).toBe("1.0.0");
  });

  it("counts up within a channel", () => {
    expect(nextVersion("0.1.0-alpha.1", "alpha")).toBe("0.1.0-alpha.2");
    expect(nextVersion("0.1.0-alpha.9", "alpha")).toBe("0.1.0-alpha.10");
  });

  it("restarts the count when moving to a later channel", () => {
    expect(nextVersion("0.1.0-alpha.4", "beta")).toBe("0.1.0-beta.1");
    expect(nextVersion("0.1.0-beta.2", "rc")).toBe("0.1.0-rc.1");
  });

  it("starts a prerelease of the *next* version, not the current one", () => {
    // 0.1.0-alpha.1 sorts BELOW 0.1.0, so someone on 0.1.0 would never be
    // offered it. The prerelease has to describe a version that has not shipped.
    expect(nextVersion("0.1.0", "alpha")).toBe("0.1.1-alpha.1");
  });

  it("makes a prerelease stable without skipping a version", () => {
    // 0.1.0 already sorts above 0.1.0-alpha.4; bumping too would waste 0.1.0.
    expect(nextVersion("0.1.0-alpha.4", "stable")).toBe("0.1.0");
    expect(nextVersion("1.0.0-rc.2", "stable")).toBe("1.0.0");
  });

  it("treats patching a prerelease as finishing it", () => {
    expect(nextVersion("0.1.0-alpha.4", "patch")).toBe("0.1.0");
  });

  it("refuses to go backwards through the channels", () => {
    // Semver sorts rc above beta above alpha, so this would produce a version
    // nobody is ever offered.
    expect(() => nextVersion("0.1.0-rc.1", "alpha")).toThrow(VersionError);
    expect(() => nextVersion("0.1.0-beta.1", "alpha")).toThrow(VersionError);
  });

  it("refuses to make a stable version stable again", () => {
    expect(() => nextVersion("1.0.0", "stable")).toThrow(VersionError);
  });

  it("accepts an exact version, prerelease or not", () => {
    expect(nextVersion("0.1.0", "1.4.2")).toBe("1.4.2");
    expect(nextVersion("0.1.0", "2.0.0-beta.7")).toBe("2.0.0-beta.7");
  });

  it("rejects anything that is neither a bump nor a version", () => {
    expect(() => nextVersion("0.1.0", "--dry-run")).toThrow(VersionError);
    expect(() => nextVersion("0.1.0", "v1.0.0")).toThrow(VersionError);
    expect(() => nextVersion("0.1.0", "1.0")).toThrow(VersionError);
  });

  it("leaves a prerelease behind when the numbers move", () => {
    expect(nextVersion("0.1.0-alpha.3", "minor")).toBe("0.2.0");
    expect(nextVersion("0.1.0-alpha.3", "major")).toBe("1.0.0");
  });
});

describe("channelOf", () => {
  it("names the channel of a prerelease", () => {
    expect(channelOf("0.1.0-alpha.1")).toBe("alpha");
    expect(channelOf("1.0.0-rc.3")).toBe("rc");
  });

  it("returns null for a stable version", () => {
    expect(channelOf("1.0.0")).toBeNull();
  });
});
