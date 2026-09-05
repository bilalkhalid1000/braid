// @vitest-environment jsdom
import { act, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "./settings";
import { useCommands } from "./useCommands";

vi.mock("./api", () => ({
  api: {
    loadSettings: () => Promise.resolve({}),
    saveSettings: () => Promise.resolve(),
  },
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A list whose Enter binding sleeps while a dialog is up, and a dialog that
 *  closes on Enter -- the shape of the sidebar behind a delete confirmation. */
function Harness({ onActivate }: { onActivate: () => void }) {
  const [open, setOpen] = useState(true);
  useCommands({ "sidebar.activate": onActivate }, !open);

  return open ? (
    <div
      data-testid="dialog"
      tabIndex={-1}
      // Flushed here rather than left to React, because a synchronous
      // dispatchEvent never yields between listeners the way a real keystroke
      // does. In the browser React's microtask runs between its root listener
      // and the document's; this puts the render in the same place.
      onKeyDown={(e) => {
        if (e.key === "Enter") flushSync(() => setOpen(false));
      }}
    />
  ) : null;
}

const tick = () => act(() => new Promise((r) => setTimeout(r, 5)));

describe("useCommands", () => {
  it("does not let the keystroke that closed a dialog reach a binding it woke", async () => {
    const activate = vi.fn();
    await act(async () => {
      root.render(
        <SettingsProvider>
          <Harness onActivate={activate} />
        </SettingsProvider>,
      );
    });

    const dialog = host.querySelector<HTMLElement>('[data-testid="dialog"]')!;
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await tick();

    expect(host.querySelector('[data-testid="dialog"]')).toBeNull();
    expect(activate).not.toHaveBeenCalled();

    // The next Enter is a fresh keystroke, and the list is awake for it.
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(activate).toHaveBeenCalledTimes(1);
  });
});
