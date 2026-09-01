// @vitest-environment jsdom
import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GONE_CHECK_MS, TipProvider, useTip } from "./Tip";

vi.mock("../lib/api", () => ({
  api: {
    loadSettings: () => Promise.resolve({}),
    saveSettings: () => Promise.resolve(),
  },
}));

let host: HTMLDivElement;
let root: Root;
/** Lets a test take the tip's subject away while it is being hovered. */
let removeTrigger: () => void;

function Harness() {
  const [present, setPresent] = useState(true);
  const tip = useTip();
  removeTrigger = () => setPresent(false);

  return present ? (
    <button data-testid="trigger" {...tip("Eight git commands running")}>
      running
    </button>
  ) : null;
}

async function mount() {
  const { SettingsProvider } = await import("../lib/settings");

  await act(async () => {
    root.render(
      <SettingsProvider>
        <TipProvider>
          <Harness />
        </TipProvider>
      </SettingsProvider>,
    );
  });
}

const shown = () => document.querySelector('[role="tooltip"]');

const hover = () =>
  act(() => {
    document
      .querySelector('[data-testid="trigger"]')!
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });

beforeEach(async () => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await mount();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the tooltip", () => {
  it("waits before appearing", () => {
    hover();
    expect(shown()).toBeNull();

    act(() => void vi.advanceTimersByTime(400));
    expect(shown()).not.toBeNull();
  });

  it("says what it was given", () => {
    hover();
    act(() => void vi.advanceTimersByTime(400));

    expect(shown()?.textContent).toContain("Eight git commands running");
  });

  it("closes when the thing it describes stops existing", () => {
    // A control can be removed while the pointer is still on it -- the
    // running-git indicator goes the moment the last command finishes -- and
    // React fires no mouseleave for an element that is simply gone. The tip
    // used to sit there describing something no longer on screen.
    hover();
    act(() => void vi.advanceTimersByTime(400));
    expect(shown()).not.toBeNull();

    act(() => removeTrigger());
    act(() => void vi.advanceTimersByTime(GONE_CHECK_MS * 2));

    expect(shown()).toBeNull();
  });

  it("stays up while its subject is still there", () => {
    hover();
    act(() => void vi.advanceTimersByTime(400));

    act(() => void vi.advanceTimersByTime(GONE_CHECK_MS * 10));

    expect(shown()).not.toBeNull();
  });
});
