// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RefsSnapshot } from "../lib/api";
import { SettingsProvider } from "../lib/settings";
import { Sidebar, type MenuTarget } from "./Sidebar";

vi.mock("../lib/api", () => ({
  api: {
    loadSettings: () => Promise.resolve({}),
    saveSettings: () => Promise.resolve(),
  },
  submoduleLabel: {},
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom lays nothing out, so it has no scrollIntoView; the cursor calls it.
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const refs: RefsSnapshot = {
  branches: [
    { name: "main", isHead: true, upstream: "origin/main", ahead: 0, behind: 0, oid: "a".repeat(40) },
  ],
  remotes: [
    { name: "origin", url: "git@example.com:x/y.git", branches: ["main", "dev"] },
    { name: "fork", url: "https://example.com/fork.git", branches: [] },
  ],
  tags: [],
  stashes: [],
};

const noop = () => {};

/** Press a key the way the sidebar's bindings see it: on the document. */
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, ...init }));
  });

const tick = () => act(() => new Promise((r) => setTimeout(r, 5)));

describe("Sidebar, remotes panel", () => {
  it("stops on the remote itself before its branches, and E edits it", async () => {
    const onEdit = vi.fn<(target: MenuTarget | null) => void>();
    const onFetchRemote = vi.fn();
    const onDelete = vi.fn();
    const cursor: (MenuTarget | null)[] = [];

    await act(async () => {
      root.render(
        <SettingsProvider>
          <Sidebar
            refs={refs}
            status={undefined}
            worktrees={[]}
            submodules={[]}
            reflog={[]}
            view="history"
            focusedPanel="remotes"
            keyboardActive
            onFocusPanel={noop}
            onCheckout={noop}
            onReveal={noop}
            onPublish={noop}
            onStash={noop}
            onOpenPath={noop}
            onNewBranch={noop}
            onNewRemote={noop}
            onNewTag={noop}
            onShowStash={noop}
            onAddWorktree={noop}
            onRemoveWorktree={noop}
            onPruneWorktrees={noop}
            onUpdateSubmodule={noop}
            onUpdateAllSubmodules={noop}
            onMenu={noop}
            onCursor={(target) => {
              cursor.push(target);
            }}
            onDelete={onDelete}
            onEdit={onEdit}
            onFetchRemote={onFetchRemote}
          />
        </SettingsProvider>,
      );
    });
    // Bindings go live a tick after the panel takes focus.
    await tick();

    // The cursor starts on origin itself, not on origin/main.
    expect(cursor[cursor.length - 1]).toMatchObject({ kind: "remoteGroup", remote: { name: "origin" } });

    press("e");
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "remoteGroup", remote: expect.objectContaining({ name: "origin" }) }),
    );

    press("Enter");
    expect(onFetchRemote).toHaveBeenCalledWith("origin");

    // Down twice: past origin's two branches, onto the fork with nothing fetched.
    press("j");
    expect(cursor[cursor.length - 1]).toMatchObject({ kind: "remote", remote: "origin", branch: "main" });
    press("j");
    press("j");
    const trail = cursor.map((c) =>
      c?.kind === "remote" ? c.branch : c?.kind === "remoteGroup" ? `group:${c.remote.name}` : String(c),
    );
    expect(cursor[cursor.length - 1], trail.join(" > ")).toMatchObject({
      kind: "remoteGroup",
      remote: { name: "fork" },
    });

    press("d");
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "remoteGroup", remote: expect.objectContaining({ name: "fork" }) }),
    );
  });
});
