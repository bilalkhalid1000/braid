// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileDiff, RepoStatus, StatusEntry } from "../lib/api";
import { SettingsProvider } from "../lib/settings";
import type { CommitBoxHandle } from "./CommitBox";
import { FileStatusView } from "./FileStatusView";

const diffFor = (path: string, lines: number): FileDiff => ({
  path,
  header: "",
  binary: false,
  truncated: false,
  hunks:
    lines === 0
      ? []
      : [{ header: "@@ -1 +1 @@", lines: [{ kind: "added", content: "x", oldLine: null, newLine: 1 }] }],
  added: lines,
  removed: 0,
  durationMs: 0,
} as unknown as FileDiff);

// After the commit git has nothing to say about the file: an empty diff.
let changed = true;

vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  api: {
    loadSettings: () => Promise.resolve({}),
    saveSettings: () => Promise.resolve(),
    fileDiff: (_repo: string, path: string) => Promise.resolve(diffFor(path, changed ? 1 : 0)),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  changed = true;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const entry: StatusEntry = {
  path: "notes.txt",
  origPath: null,
  indexStatus: ".",
  worktreeStatus: "M",
  kind: "ordinary",
};

const statusWith = (entries: StatusEntry[]): RepoStatus => ({
  head: "main",
  headOid: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  entries,
  stagedCount: 0,
  unstagedCount: entries.length,
  untrackedCount: 0,
  conflictedCount: 0,
  state: "clean",
  durationMs: 0,
});

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("FileStatusView", () => {
  it("lets go of a selected file once it is committed", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const noop = () => {};
    const view = (status: RepoStatus) => (
      <QueryClientProvider client={client}>
        <SettingsProvider>
          <FileStatusView
            repoId="repo"
            keyboardActive
            status={status}
            busy={false}
            commitRef={createRef<CommitBoxHandle>()}
            onStage={noop}
            onUnstage={noop}
            onDiscard={noop}
            onBlame={noop}
            onMenu={noop}
            onCommit={() => Promise.resolve(true)}
            onHunk={noop}
            onResolve={noop}
            onMarkResolved={noop}
            onEdit={noop}
            onMergeTool={noop}
            messageHistory={[]}
          />
        </SettingsProvider>
      </QueryClientProvider>
    );

    await act(async () => root.render(view(statusWith([entry]))));
    await wait(20);
    // J: the first file, as the list's own binding picks it.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "j", bubbles: true }));
    });
    await wait(300);
    const header = () => {
      // The file lists have headers of their own; the diff pane's is last.
      const all = host.querySelectorAll("header");
      return all[all.length - 1]?.textContent ?? "";
    };
    // react-query's update does not reach the view in jsdom; rendering again
    // reads what it holds.
    await act(async () => root.render(view(statusWith([entry]))));
    expect(header()).toContain("notes.txt");

    // Committed: the list empties and the repository's reads are refetched.
    changed = false;
    await act(async () => root.render(view(statusWith([]))));
    await act(() => client.invalidateQueries({ queryKey: ["diff"] }));
    await wait(300);
    await act(async () => root.render(view(statusWith([]))));

    expect(header()).not.toContain("notes.txt");
    expect(header()).toContain("No file selected");
  });
});
