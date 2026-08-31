import { describe, expect, it } from "vitest";

import { channelCaution, channelLabel, releaseChannel } from "./version";

describe("releaseChannel", () => {
  it("reads a plain release as no channel", () => {
    expect(releaseChannel("1.2.0")).toBeNull();
    expect(releaseChannel("0.1.0")).toBeNull();
  });

  it("recognises the usual prerelease names", () => {
    expect(releaseChannel("0.1.0-alpha.1")).toBe("alpha");
    expect(releaseChannel("0.1.0-beta.3")).toBe("beta");
    expect(releaseChannel("1.0.0-rc.2")).toBe("rc");
  });

  it("ignores case", () => {
    expect(releaseChannel("0.1.0-Alpha.1")).toBe("alpha");
  });

  it("handles a prerelease with no number", () => {
    expect(releaseChannel("0.1.0-alpha")).toBe("alpha");
  });

  it("calls anything else a dev build rather than nothing", () => {
    // Unrecognised is still not stable, and saying so beats staying silent.
    expect(releaseChannel("0.1.0-nightly.4")).toBe("dev");
    expect(releaseChannel("0.1.0-canary")).toBe("dev");
  });

  it("is not confused by build metadata on a stable version", () => {
    expect(releaseChannel("1.2.0+build.55")).toBeNull();
  });

  it("gives every channel a label and a caution, and a stable release neither", () => {
    for (const version of ["0.1.0-alpha.1", "0.1.0-beta.1", "1.0.0-rc.1", "0.1.0-x.1"]) {
      const channel = releaseChannel(version);
      expect(channelLabel(channel).length).toBeGreaterThan(0);
      expect(channelCaution(channel).length).toBeGreaterThan(0);
    }

    expect(channelLabel(null)).toBe("");
    expect(channelCaution(null)).toBe("");
  });
});
