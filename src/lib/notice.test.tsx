// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoticeProvider, useNotice } from "./notice";

let host: HTMLDivElement;
let root: Root;
let notify: (message: string) => void;

function Harness() {
  notify = useNotice();
  return null;
}

/** A component outside the provider, which must still be able to call it. */
function Loose() {
  const say = useNotice();
  say("into the void");
  return null;
}

const shown = () => document.body.textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const mount = (node: React.ReactNode) => act(() => root.render(node));

describe("the notice", () => {
  beforeEach(() => {
    mount(
      <NoticeProvider>
        <Harness />
      </NoticeProvider>,
    );
  });

  it("says nothing until something has happened", () => {
    expect(shown()).toBe("");
  });

  it("shows what it was given", () => {
    act(() => notify("Copied 3f2a1b9"));

    expect(shown()).toContain("Copied 3f2a1b9");
  });

  it("takes itself away", () => {
    act(() => notify("Copied"));
    act(() => void vi.advanceTimersByTime(2000));

    expect(shown()).toBe("");
  });

  it("restarts rather than queueing", () => {
    // Two copies in a row is one person repeating themselves, not two things
    // to read in turn.
    act(() => notify("first"));
    act(() => void vi.advanceTimersByTime(1500));
    act(() => notify("second"));
    act(() => void vi.advanceTimersByTime(400));

    expect(shown()).toContain("second");
    expect(shown()).not.toContain("first");
  });

  it("is announced politely, not interrupted into", () => {
    // Cutting a screen reader off to repeat what the user just did is not help.
    act(() => notify("Copied"));

    const live = document.querySelector("[aria-live]");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.getAttribute("role")).toBe("status");
  });
});

describe("outside the provider", () => {
  it("is a no-op rather than a crash", () => {
    // A component rendered on its own -- in a test, or before the provider is
    // mounted -- should not have to care.
    expect(() => mount(<Loose />)).not.toThrow();
  });
});
