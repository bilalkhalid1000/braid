#!/usr/bin/env node
/**
 * Measure the git commands the app's hot paths are built from.
 *
 * This times the *floor*, not the app: every number here is what git itself
 * costs on this machine for that repository. The app cannot be faster than
 * this, and the gap between these numbers and what the window feels like is
 * the part that belongs to our code.
 *
 * Being explicit about that matters, because a benchmark that quietly measured
 * the wrong layer would be worse than none — it would make PLAN.md's claims
 * look verified when they were not.
 *
 *   node bench/run.mjs            # table
 *   node bench/run.mjs --json     # machine-readable, for tracking over time
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = join(process.cwd(), "bench", "fixtures");

/** Passed on every call, matching what the app does. */
const PERF = ["-c", "core.fsmonitor=true", "-c", "core.untrackedCache=true"];

const CASES = [
  {
    name: "status",
    what: "Working copy status, the refresh on every file change",
    args: ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"],
  },
  {
    name: "log page",
    what: "One page of history, what opening the History view costs",
    args: ["log", "--date-order", "--format=%H%x1f%s", "--max-count=300"],
  },
  {
    name: "log 5k",
    what: "Deep paging, five pages in",
    args: ["log", "--date-order", "--format=%H%x1f%s", "--skip=5000", "--max-count=300"],
  },
  {
    name: "refs",
    what: "Branches, tags and remotes for the sidebar",
    args: ["for-each-ref", "--format=%(refname:short)", "refs/"],
  },
  {
    name: "commit detail",
    what: "The file list for one commit",
    args: ["show", "--numstat", "-z", "--format=", "-M", "HEAD"],
  },
];

const RUNS = 5;

async function time(cwd, args) {
  const samples = [];

  // One untimed pass first: the first call warms git's caches and the OS file
  // cache, and timing that instead would measure the disk, not the command.
  await run("git", [...PERF, ...args], { cwd, maxBuffer: 1 << 28 });

  for (let i = 0; i < RUNS; i++) {
    const started = process.hrtime.bigint();
    await run("git", [...PERF, ...args], { cwd, maxBuffer: 1 << 28 });
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }

  samples.sort((a, b) => a - b);

  return {
    // The median, not the mean: one scheduler hiccup should not move the
    // number that gets quoted.
    median: +samples[Math.floor(samples.length / 2)].toFixed(1),
    best: +samples[0].toFixed(1),
    worst: +samples[samples.length - 1].toFixed(1),
  };
}

if (!existsSync(ROOT)) {
  console.error("No fixtures. Run: node bench/generate.mjs");
  process.exit(1);
}

const fixtures = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const results = [];

for (const fixture of fixtures) {
  const cwd = join(ROOT, fixture);

  for (const testCase of CASES) {
    const timing = await time(cwd, testCase.args);
    results.push({ fixture, case: testCase.name, ...timing });
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ measured: new Date().toISOString(), results }, null, 2));
} else {
  console.log("\nMilliseconds per git call, median of 5 after a warm-up.\n");
  console.table(results);
  console.log(
    "\nThis is git's own cost on this machine — the floor the app builds on,\n" +
      "not a measurement of the app. Anything slower in the window is ours.",
  );
}
