// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPIED_MS, useCopy } from "./useCopy";
import { NoticeProvider } from "./notice";

let host: HTMLDivElement;
let root: Root;
let written: string[];
let allow: boolean;

/** What the component under test exposes to the test. */
let api: ReturnType<typeof useCopy>;

function Harness() {
  api = useCopy();
  return <span>{api.copied ?? "nothing"}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  written = [];
  allow = true;

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        if (!allow) return Promise.reject(new Error("denied"));
        written.push(text);
        return Promise.resolve();
      },
    },
  });

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  act(() => {
    root.render(
      <NoticeProvider>
        <Harness />
      </NoticeProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const copy = async (id: string, text: string, shown?: string) => {
  let result = false;
  await act(async () => {
    result = await api.copy(id, text, shown);
  });
  return result;
};

describe("useCopy", () => {
  it("puts the text on the clipboard", async () => {
    await copy("a", "the full forty characters");

    expect(written).toEqual(["the full forty characters"]);
  });

  it("remembers what was copied, by name", async () => {
    // A whole list shares one of these: a row asks whether it is the thing
    // that was copied, and only that row lights up.
    await copy("commit-a", "aaa");

    expect(api.copied).toBe("commit-a");
  });

  it("forgets after the mark has had time to be read", async () => {
    await copy("a", "aaa");
    expect(api.copied).toBe("a");

    act(() => void vi.advanceTimersByTime(COPIED_MS + 1));

    expect(api.copied).toBeNull();
  });

  it("restarts the clock rather than expiring on the first copy's schedule", async () => {
    await copy("a", "aaa");
    act(() => void vi.advanceTimersByTime(COPIED_MS - 100));

    await copy("b", "bbb");
    act(() => void vi.advanceTimersByTime(200));

    // The second copy's mark should still be up: the timer restarted.
    expect(api.copied).toBe("b");
  });

  it("claims nothing when the clipboard refuses", async () => {
    // An unfocused document or a locked-down webview. A confirmation that
    // appears anyway is worse than none: the text is not there and the user
    // has stopped checking.
    allow = false;

    const ok = await copy("a", "aaa");

    expect(ok).toBe(false);
    expect(api.copied).toBeNull();
  });

  it("says what was copied, in the short form", async () => {
    await copy("oid", "a".repeat(40), "3f2a1b9");

    expect(host.ownerDocument.body.textContent).toContain("Copied 3f2a1b9");
  });

  it("falls back to the copied text when there is no short form", async () => {
    await copy("branch", "feature/search");

    expect(host.ownerDocument.body.textContent).toContain("Copied feature/search");
  });

  it("says nothing when the copy failed", async () => {
    allow = false;

    await copy("a", "aaa");

    expect(host.ownerDocument.body.textContent).not.toContain("Copied");
  });
});
