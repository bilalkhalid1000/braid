// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsProvider } from "../lib/settings";
import { KeyHints } from "./KeyHints";

/** What the settings file says, per test. */
let stored: Record<string, unknown> = {};

vi.mock("../lib/api", () => ({
  api: {
    loadSettings: () => Promise.resolve(stored),
    saveSettings: () => Promise.resolve(),
  },
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  stored = {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(scope: Parameters<typeof KeyHints>[0]["scope"]) {
  await act(async () => {
    root.render(
      <SettingsProvider>
        <KeyHints scope={scope} />
      </SettingsProvider>,
    );
  });
  // The provider reads the settings file after mounting.
  await act(() => new Promise((r) => setTimeout(r, 5)));
}

/** The strip's entries: each key-and-word run, as text. */
const entries = () =>
  Array.from(host.querySelectorAll("p.pane-hint > span")).map((span) =>
    span.textContent?.replace(/\s+/g, " ").trim(),
  );

describe("KeyHints", () => {
  it("lists a scope's own keys, the globals that belong beside them, and the way to all keys", async () => {
    await render("sidebar");
    const shown = entries();

    expect(shown).toContain("␣ use");
    expect(shown).toContain("d delete");
    expect(shown).toContain("e edit");
    expect(shown).toContain("n new branch");
    expect(shown).toContain("? all keys");
    expect(shown.some((e) => e?.includes("commit"))).toBe(false);
  });

  it("shows next and previous as one pair", async () => {
    await render("history");
    const move = entries().find((e) => e?.endsWith("move"));

    expect(move).toBe("jk move");
    expect(entries().filter((e) => e?.endsWith("move"))).toHaveLength(1);
  });

  it("leaves out a command the user has unbound", async () => {
    stored = { keymap: { "sidebar.delete": [] } };
    await render("sidebar");

    expect(entries().some((e) => e?.endsWith("delete"))).toBe(false);
    expect(entries()).toContain("e edit");
  });

  it("falls back to the repository-wide keys with no list in front", async () => {
    await render(null);

    expect(entries()).toContain("c commit");
    expect(entries()).toContain("? all keys");
  });
});
