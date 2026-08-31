#!/usr/bin/env node
/**
 * Build synthetic repositories to measure against.
 *
 * The sizes matter more than the content. A repository is slow for two
 * unrelated reasons — how much history it has, and how much untracked junk sits
 * in the worktree — so the fixtures vary those independently. The
 * `node_modules` pairing is the one that reproduces the problem this app exists
 * to solve: on Windows, `git status` walking a large ignored tree is the
 * dominant cost, and history has nothing to do with it.
 *
 * History is written through `git fast-import` rather than a loop of `git
 * commit`. A commit per process is about 40ms on Windows, which puts a
 * 20,000-commit fixture at a quarter of an hour — slow enough that nobody would
 * ever run the benchmark. fast-import does the same work in seconds.
 *
 *   node bench/generate.mjs                 # the default set
 *   node bench/generate.mjs --only small    # just one
 *   node bench/generate.mjs --big           # adds the 200k-commit fixture
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "bench", "fixtures");

const FIXTURES = [
  { name: "small", commits: 1_000, files: 40, junk: 0 },
  { name: "medium", commits: 20_000, files: 300, junk: 0 },
  // Same history, one with a large ignored tree: the only difference between
  // them is the thing being measured.
  { name: "medium-node_modules", commits: 20_000, files: 300, junk: 20_000 },
  { name: "large", commits: 200_000, files: 800, junk: 0, slow: true },
];

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

/** A fast-import `data` block: a byte count, then exactly that many bytes. */
const data = (text) => `data ${Buffer.byteLength(text)}\n${text}\n`;

function history({ commits, files }) {
  const stream = [];
  const when = 1_700_000_000;

  for (let i = 0; i < commits; i++) {
    const file = `file-${i % files}.txt`;

    stream.push(`commit refs/heads/main\n`);
    stream.push(`committer Bench <bench@example.invalid> ${when + i} +0000\n`);
    stream.push(data(i === 0 ? "Initial commit" : `Change ${i} to ${file}`));

    if (i === 0) {
      // The first commit lays down every file plus the ignore rule; the rest
      // touch one file each, so history has breadth as well as depth.
      stream.push(`M 644 inline .gitignore\n`, data("node_modules/\n"));

      for (let f = 0; f < files; f++) {
        stream.push(`M 644 inline file-${f}.txt\n`, data(`line 0 of file ${f}`));
      }
    } else {
      stream.push(`M 644 inline ${file}\n`, data(`line ${i} of ${file}`));
    }

    stream.push("\n");
  }

  stream.push("done\n");
  return stream.join("");
}

function build({ name, commits, files, junk }) {
  const dir = join(ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  process.stdout.write(`${name}: history…`);

  git(dir, "init", "--quiet", "--initial-branch=main");
  git(dir, "config", "user.name", "Bench");
  git(dir, "config", "user.email", "bench@example.invalid");

  const result = spawnSync("git", ["fast-import", "--quiet", "--done"], {
    cwd: dir,
    input: history({ commits, files }),
    maxBuffer: 1 << 30,
  });

  if (result.status !== 0) {
    throw new Error(`fast-import failed: ${result.stderr?.toString() ?? "unknown"}`);
  }

  // fast-import only writes the objects and the ref; the worktree and index are
  // still empty, and `git status` on an empty index would report every file as
  // deleted rather than clean.
  git(dir, "reset", "--hard", "main");

  if (junk > 0) {
    process.stdout.write(" junk…");
    const modules = join(dir, "node_modules");

    for (let i = 0; i < junk; i++) {
      const pkg = join(modules, `pkg-${i % 500}`);
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, `index-${i}.js`), `module.exports = ${i};\n`);
    }
  }

  // The commit-graph is what makes history traversal cheap, and the app assumes
  // it exists. Building it keeps the measurement about traversal, not about
  // whether someone remembered to run maintenance.
  process.stdout.write(" commit-graph…");
  git(dir, "commit-graph", "write", "--reachable");

  console.log(` ${commits} commits, ${files} files, ${junk} ignored`);
}

const only = process.argv.indexOf("--only");
const wanted =
  only !== -1
    ? FIXTURES.filter((f) => f.name === process.argv[only + 1])
    : FIXTURES.filter((f) => !f.slow || process.argv.includes("--big"));

if (wanted.length === 0) {
  console.error(`No such fixture. Known: ${FIXTURES.map((f) => f.name).join(", ")}`);
  process.exit(1);
}

mkdirSync(ROOT, { recursive: true });
const started = Date.now();

for (const fixture of wanted) build(fixture);

console.log(`\nBuilt in ${((Date.now() - started) / 1000).toFixed(1)}s → ${ROOT}`);
console.log("Throwaway: delete that directory to reclaim the space.");
