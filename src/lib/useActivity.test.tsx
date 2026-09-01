// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { headline, useActivity } from "./useActivity";

let host: HTMLDivElement;
let root: Root;
let activity: ReturnType<typeof useActivity>;

function Harness() {
  activity = useActivity();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const run = async (label: string, action: () => Promise<unknown>) => {
  let ok = false;
  await act(async () => {
    ok = await activity.run(label, action);
  });
  return ok;
};

describe("useActivity", () => {
  it("records what was attempted and that it worked", async () => {
    const ok = await run("Push", () => Promise.resolve("Everything up-to-date"));

    expect(ok).toBe(true);
    expect(activity.entries[0]!.label).toBe("Push");
    expect(activity.entries[0]!.status).toBe("success");
    expect(activity.entries[0]!.detail).toBe("Everything up-to-date");
  });

  it("keeps what git said when it failed", async () => {
    // The whole reason the log exists: an error the app did not anticipate
    // still has git's own words attached.
    const ok = await run("Push", () => Promise.reject("fatal: no upstream"));

    expect(ok).toBe(false);
    expect(activity.entries[0]!.status).toBe("error");
    expect(activity.entries[0]!.detail).toBe("fatal: no upstream");
  });

  it("normalizes a thrown Error as well as a rejected string", async () => {
    await run("Fetch", () => Promise.reject(new Error("network is down")));

    expect(activity.entries[0]!.detail).toBe("network is down");
  });

  it("reports what is in flight while it is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => (release = resolve));

    let finished: Promise<boolean>;
    act(() => {
      finished = activity.run("Clone", () => pending);
    });

    expect(activity.running).toHaveLength(1);
    expect(activity.running[0]!.label).toBe("Clone");

    await act(async () => {
      release("done");
      await finished!;
    });

    expect(activity.running).toHaveLength(0);
  });

  it("times what it ran", async () => {
    await run("Status", () => Promise.resolve(""));

    expect(activity.entries[0]!.durationMs).toBeDefined();
  });

  it("gets a success toast out of the way on its own", async () => {
    await run("Fetch", () => Promise.resolve(""));
    expect(activity.toasts).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(4000));

    expect(activity.toasts).toHaveLength(0);
  });

  it("leaves a failure up until it is dismissed", async () => {
    // A failure nobody saw is a failure that gets repeated.
    await run("Push", () => Promise.reject("fatal: rejected"));

    act(() => void vi.advanceTimersByTime(60_000));
    expect(activity.toasts).toHaveLength(1);

    act(() => activity.dismiss(activity.toasts[0]!.id));
    expect(activity.toasts).toHaveLength(0);
  });

  it("counts the failures", async () => {
    await run("One", () => Promise.reject("bad"));
    await run("Two", () => Promise.resolve(""));
    await run("Three", () => Promise.reject("also bad"));

    expect(activity.errorCount).toBe(2);
  });

  it("keeps the newest first", async () => {
    await run("First", () => Promise.resolve(""));
    await run("Second", () => Promise.resolve(""));

    expect(activity.entries.map((entry) => entry.label)).toEqual(["Second", "First"]);
  });

  it("records something that already happened", async () => {
    act(() => activity.note("Restore", "two paths are gone", "error"));

    expect(activity.entries[0]!.label).toBe("Restore");
    expect(activity.entries[0]!.status).toBe("error");
    expect(activity.toasts).toHaveLength(1);
  });

  it("clears everything, log and toasts alike", async () => {
    await run("One", () => Promise.reject("bad"));

    act(() => activity.clear());

    expect(activity.entries).toHaveLength(0);
    expect(activity.toasts).toHaveLength(0);
  });
});

describe("headline", () => {
  it("prefers the line that says what went wrong", () => {
    // Git puts progress and hints around the sentence worth reading.
    const detail = "Enumerating objects: 5, done.\nfatal: could not read from remote\nhint: try again";

    expect(headline(detail)).toBe("fatal: could not read from remote");
  });

  it("falls back to the first line when nothing is marked", () => {
    expect(headline("Everything up-to-date\nsomething else")).toBe("Everything up-to-date");
  });

  it("has nothing to say about nothing", () => {
    expect(headline("")).toBe("");
    expect(headline("\n  \n")).toBe("");
  });
});
