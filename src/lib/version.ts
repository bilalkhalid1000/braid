/** Which release channel a version string describes.
 *
 *  Derived from the version rather than configured separately, so the badge
 *  cannot outlive the thing it describes. A hardcoded "alpha" flag is one
 *  someone forgets to remove, and a stable build that still calls itself alpha
 *  is worse than no badge at all.
 */
export type Channel = "alpha" | "beta" | "rc" | "dev" | null;

const LABELS: Record<Exclude<Channel, null>, string> = {
  alpha: "alpha",
  beta: "beta",
  rc: "release candidate",
  dev: "dev build",
};

/** The channel, or null for a plain release like `1.2.0`. */
export function releaseChannel(version: string): Channel {
  const prerelease = version.split("-")[1];
  if (!prerelease) return null;

  const name = prerelease.split(".")[0].toLowerCase();

  if (name === "alpha") return "alpha";
  if (name === "beta") return "beta";
  if (name === "rc") return "rc";

  // Something prerelease-shaped but unrecognised is still not a stable
  // release, and saying so is more useful than saying nothing.
  return "dev";
}

export const channelLabel = (channel: Channel): string =>
  channel ? LABELS[channel] : "";

/** What to warn people about, in the app's voice. Empty for a stable release. */
export function channelCaution(channel: Channel): string {
  switch (channel) {
    case "alpha":
      return "An early build. Expect rough edges, and keep a backup of anything you cannot lose.";
    case "beta":
      return "Feature complete but still being tested.";
    case "rc":
      return "A candidate for release. Report anything that looks wrong.";
    case "dev":
      return "An unreleased build.";
    default:
      return "";
  }
}
