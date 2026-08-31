/**
 * Working out the next version.
 *
 * Kept separate from the release script because it is the part with rules worth
 * checking, and because a mistake here is expensive: semver decides whether an
 * installed copy is offered an update at all. A version that sorts *below* what
 * someone already has is simply never delivered, with nothing to indicate why.
 */

export const CHANNELS = ["alpha", "beta", "rc"];

const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

export class VersionError extends Error {}

/**
 * @param {string} version the current version
 * @param {string} kind    patch | minor | major | alpha | beta | rc | stable | an exact version
 */
export function nextVersion(version, kind) {
  if (EXACT.test(kind)) return kind;

  const [core, prerelease] = version.split("-");
  const [major, minor, patch] = core.split(".").map(Number);

  // "stable" drops the suffix and leaves the numbers alone: 0.1.0 already sorts
  // above 0.1.0-alpha.4, so bumping as well would skip a version for no reason.
  if (kind === "stable") {
    if (!prerelease) throw new VersionError(`${version} is already stable.`);
    return core;
  }

  if (CHANNELS.includes(kind)) {
    const [currentChannel, currentCount] = (prerelease ?? "").split(".");

    if (currentChannel && CHANNELS.includes(currentChannel)) {
      if (CHANNELS.indexOf(currentChannel) > CHANNELS.indexOf(kind)) {
        throw new VersionError(
          `${version} is already past ${kind}. Going back would produce a version ` +
            `semver treats as older, and no installed copy would ever be offered it.`,
        );
      }
    }

    const count = currentChannel === kind ? Number(currentCount ?? 0) + 1 : 1;

    // A prerelease has to describe a version that has not shipped. Starting one
    // from a released 0.1.0 means the next one, or it sorts below what people
    // already have installed.
    const base = prerelease ? core : `${major}.${minor}.${patch + 1}`;
    return `${base}-${kind}.${count}`;
  }

  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;

  // Finishing a prerelease is a patch release of the version it was leading to,
  // not the one after it.
  if (kind === "patch") return prerelease ? core : `${major}.${minor}.${patch + 1}`;

  throw new VersionError(`Not a version or a bump: ${kind}`);
}

/** The channel a version implies, or null for a stable one. */
export function channelOf(version) {
  const prerelease = version.split("-")[1];
  return prerelease ? prerelease.split(".")[0] : null;
}
