import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { createRepoInvalidator } from "./repoInvalidation";

/** A read that finishes when the test says so. */
function gate() {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let client: QueryClient;
let dispose: () => void = () => {};

afterEach(() => {
  dispose();
  client.clear();
});

/** An observed query whose reads are counted and held open until released. */
function watch(queryKey: unknown[]) {
  const reads: { open: () => void }[] = [];
  let finished = 0;

  const observer = new QueryObserver(client, {
    queryKey,
    staleTime: Infinity,
    queryFn: async () => {
      const read = gate();
      reads.push(read);
      await read.promise;
      finished += 1;
      return finished;
    },
  });
  const stop = observer.subscribe(() => {});

  return {
    reads,
    finished: () => finished,
    data: () => observer.getCurrentResult().data,
    stop,
  };
}

function setup() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const made = createRepoInvalidator(client);
  dispose = made.dispose;
  return made;
}

describe("createRepoInvalidator", () => {
  it("lets a read in progress finish, then reads once more for every change during it", async () => {
    const { invalidate } = setup();
    const log = watch(["log", "repo"]);
    await settle();
    expect(log.reads).toHaveLength(1);

    // Three changes arrive while the first read is still out.
    invalidate("repo");
    invalidate("repo");
    invalidate("repo");
    await settle();
    expect(log.reads).toHaveLength(1);

    log.reads[0]!.open();
    await settle();
    // The first read was not thrown away, and one more follows it.
    expect(log.finished()).toBe(1);
    expect(log.reads).toHaveLength(2);

    log.reads[1]!.open();
    await settle();
    expect(log.data()).toBe(2);
    expect(log.reads).toHaveLength(2);
    log.stop();
  });

  it("refetches straight away when nothing is reading", async () => {
    const { invalidate } = setup();
    const status = watch(["status", "repo"]);
    await settle();
    status.reads[0]!.open();
    await settle();

    invalidate("repo");
    await settle();
    expect(status.reads).toHaveLength(2);
    status.stop();
  });

  it("leaves other repositories, commits, and blame at a commit alone", async () => {
    const { invalidate } = setup();
    const other = watch(["status", "elsewhere"]);
    const commit = watch(["commit", "repo", "abc123"]);
    const pinned = watch(["blame", "repo", "a.txt", "abc123"]);
    const working = watch(["blame", "repo", "a.txt", null]);
    await settle();
    for (const query of [other, commit, pinned, working]) query.reads[0]!.open();
    await settle();

    invalidate("repo");
    await settle();

    expect(other.reads).toHaveLength(1);
    expect(commit.reads).toHaveLength(1);
    expect(pinned.reads).toHaveLength(1);
    expect(working.reads).toHaveLength(2);
    for (const query of [other, commit, pinned, working]) query.stop();
  });
});
