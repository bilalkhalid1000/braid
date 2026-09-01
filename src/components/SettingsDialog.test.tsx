// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, type Settings } from "../lib/settings";

/** The dialog talks to the backend for settings and for the terminal list.
 *  Neither exists in a test, and neither is what is being tested. */
const saved: Settings[] = [];

vi.mock("../lib/api", () => ({
  api: {
    loadSettings: () => Promise.resolve({}),
    saveSettings: (settings: Settings) => {
      saved.push(settings);
      return Promise.resolve();
    },
    terminalOptions: () =>
      Promise.resolve([
        { id: "auto", label: "Choose automatically" },
        { id: "wt", label: "Windows Terminal" },
        { id: "custom", label: "Custom command" },
      ]),
    appVersion: () => Promise.resolve({ version: "0.0.0", channel: "" }),
  },
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  saved.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Press a key on whatever currently has the focus. */
function press(key: string) {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

async function open() {
  const { SettingsProvider } = await import("../lib/settings");
  const { SettingsDialog } = await import("./SettingsDialog");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SettingsProvider>
          <SettingsDialog onClose={() => {}} />
        </SettingsProvider>
      </QueryClientProvider>,
    );
  });

  // Let the stored settings land, or every change is written over on load.
  await act(async () => {
    await Promise.resolve();
  });
}

const theme = () => host.querySelector<HTMLSelectElement>("select")!;

describe("the settings dialog, by keyboard alone", () => {
  it("opens with the keyboard on itself", async () => {
    await open();

    expect(document.activeElement).toBe(host.querySelector(".settings"));
  });

  it("changes a select with the arrow keys", async () => {
    await open();

    expect(theme().value).toBe(DEFAULT_SETTINGS.theme);

    press("ArrowRight");

    expect(theme().value).not.toBe(DEFAULT_SETTINGS.theme);
  });

  it("changes a select with l, the way the rest of the app moves", async () => {
    await open();

    press("l");

    expect(theme().value).not.toBe(DEFAULT_SETTINGS.theme);
  });

  it("changes the select the user is actually looking at", async () => {
    // Reaching a control by Tab or by clicking it moves the focus but not the
    // cursor. If those two disagree, the arrow key changes some other row and
    // the one on screen never moves -- while the native change is suppressed,
    // so nothing happens at all.
    await open();

    const select = theme();
    act(() => select.focus());

    press("ArrowRight");

    expect(select.value).not.toBe(DEFAULT_SETTINGS.theme);
  });

  it("changes a select further down the page, not the one at the top", async () => {
    // The first select is also the first row, so focus and the cursor agree by
    // accident. Reaching any other one is where they come apart.
    await open();

    const selects = [...host.querySelectorAll<HTMLSelectElement>("select")];
    const terminal = selects[1]!;
    const before = theme().value;

    act(() => terminal.focus());
    press("ArrowRight");

    expect(theme().value).toBe(before);
    expect(terminal.value).not.toBe("auto");
  });

  it("toggles a checkbox with Enter once the cursor is on it", async () => {
    await open();

    const before = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked;
    press("ArrowDown");
    press("Enter");

    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(
      !before,
    );
  });
});
