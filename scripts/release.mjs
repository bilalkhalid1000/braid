#!/usr/bin/env node
/**
 * Cut a release: bump the version, tag it, push, and let CI do the rest.
 *
 *   pnpm release alpha          0.1.0-alpha.1 -> 0.1.0-alpha.2
 *   pnpm release beta           0.1.0-alpha.4 -> 0.1.0-beta.1
 *   pnpm release stable         0.1.0-alpha.4 -> 0.1.0
 *   pnpm release patch          0.1.0 -> 0.1.1
 *   pnpm release minor|major
 *   pnpm release 1.4.2          an exact version
 *   pnpm release alpha --dry-run
 *
 * The version lives in three files and they have to agree: package.json,
 * tauri.conf.json, and Cargo.toml. The updater compares the version in the
 * release manifest against the one compiled into the running binary, so a
 * mismatch means either an update nobody is offered or one offered forever.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { VersionError, channelOf, nextVersion } from "./nextVersion.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bump = args.find((arg) => !arg.startsWith("--"));

const run = (cmd, ...args) =>
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

const say = (message) => console.log(message);

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!bump) {
  fail(
    "Usage: pnpm release <bump> [--dry-run]\n\n" +
      "  alpha | beta | rc     a prerelease in that channel\n" +
      "  stable                drop the prerelease suffix\n" +
      "  patch | minor | major\n" +
      "  1.4.2                 an exact version",
  );
}

// --- work out the new version ---------------------------------------------

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const current = pkg.version;

let version;
try {
  version = nextVersion(current, bump);
} catch (error) {
  if (error instanceof VersionError) fail(error.message);
  throw error;
}
const tag = `v${version}`;

say(`\n${current} -> ${version}\n`);

// --- refuse to release something that is not committed --------------------

if (run("git", "status", "--porcelain") !== "") {
  fail(
    "The working tree has uncommitted changes.\n" +
      "A release is built from the tag, so anything uncommitted would not be in it.",
  );
}

const existing = run("git", "tag", "--list", tag);
if (existing !== "") {
  fail(`${tag} already exists. Pick another version, or delete the tag first.`);
}

// --- the three files that must agree --------------------------------------

const edits = [
  {
    file: "package.json",
    apply: (text) => text.replace(/"version": "[^"]+"/, `"version": "${version}"`),
  },
  {
    file: "src-tauri/tauri.conf.json",
    apply: (text) => text.replace(/"version": "[^"]+"/, `"version": "${version}"`),
  },
  {
    // Only the package's own version line, which is the first one in the file.
    // A blind replace here would rewrite a dependency's version instead.
    file: "src-tauri/Cargo.toml",
    apply: (text) => text.replace(/^version = "[^"]+"/m, `version = "${version}"`),
  },
];

for (const { file, apply } of edits) {
  const before = readFileSync(file, "utf8");
  const after = apply(before);

  if (before === after) fail(`Could not find a version to update in ${file}`);
  if (!dryRun) writeFileSync(file, after);

  say(`  ${dryRun ? "would update" : "updated"} ${file}`);
}

if (dryRun) {
  say("\nDry run: nothing written, nothing tagged.\n");
  process.exit(0);
}

// Cargo.lock records the package's own version too, and a stale one makes the
// next build dirty the tree.
try {
  run("cargo", "update", "--manifest-path", "src-tauri/Cargo.toml", "--package", "braid", "--precise", version);
} catch {
  // Older cargo cannot re-pin a local package this way; the lockfile updates
  // itself on the next build, so this is not worth failing over.
}

run("git", "add", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock");
run("git", "commit", "-m", `chore: release ${version}`);
run("git", "tag", "-a", tag, "-m", `Braid ${version}`);

const channel = channelOf(version);

say(`\nCommitted and tagged ${tag}.`);
if (channel) {
  say(`A ${channel} build — the app shows that badge, and the release is named for it.`);
}

say("\nPush it to start the build:");
say(`  git push && git push origin ${tag}`);
say("\nCI builds the installers and opens a draft release.");
say("Nobody is offered the update until you publish that draft.\n");
