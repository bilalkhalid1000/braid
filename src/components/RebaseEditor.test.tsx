// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RebasePlan, RebaseStep } from "../lib/api";
import { RebaseEditor } from "./RebaseEditor";

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

const plan: RebasePlan = {
  base: "0000000000000000000000000000000000000000",
  commits: [
    { oid: "a".repeat(40), short: "aaaaaaa", subject: "Add a", message: "Add a" },
    { oid: "b".repeat(40), short: "bbbbbbb", subject: "Add b", message: "Add b" },
    { oid: "c".repeat(40), short: "ccccccc", subject: "Add c", message: "Add c" },
  ],
  upstream: null,
  published: 0,
};

/** Press a key on the editor's frame, as a user with it focused would. */
function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    host
      .querySelector<HTMLElement>('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

const actions = () =>
  Array.from(host.querySelectorAll<HTMLSelectElement>("select")).map((s) => s.value);

describe("RebaseEditor", () => {
  it("sets actions, reorders, and refuses to fold the first row", () => {
    const onRun = vi.fn<(base: string, steps: RebaseStep[]) => void>();
    act(() => {
      root.render(<RebaseEditor plan={plan} onClose={() => {}} onRun={onRun} />);
    });

    press("d"); // drop a
    press("j");
    press("s"); // squash b into a
    expect(actions()).toEqual(["drop", "squash", "pick"]);

    press("K"); // b moves above a: now first, and a squash cannot be first
    expect(actions()).toEqual(["squash", "drop", "pick"]);
    press("Enter", { ctrlKey: true });
    expect(onRun).not.toHaveBeenCalled();

    press("p"); // b becomes a pick, which can lead
    press("Enter", { ctrlKey: true });
    expect(onRun).toHaveBeenCalledTimes(1);

    const [base, steps] = onRun.mock.calls[0]!;
    expect(base).toBe(plan.base);
    expect(steps.map((s) => [s.action, s.oid[0]])).toEqual([
      ["pick", "b"],
      ["drop", "a"],
      ["pick", "c"],
    ]);
  });

  it("starts on the preset commit with its action, and carries the message for a reword", () => {
    const onRun = vi.fn<(base: string, steps: RebaseStep[]) => void>();
    act(() => {
      root.render(
        <RebaseEditor
          plan={plan}
          preset={{ oid: "b".repeat(40), action: "reword" }}
          onClose={() => {}}
          onRun={onRun}
        />,
      );
    });

    expect(actions()).toEqual(["pick", "reword", "pick"]);
    const message = host.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(message.value).toBe("Add b");

    press("Enter", { ctrlKey: true });
    expect(onRun.mock.calls[0]![1][1]).toMatchObject({ action: "reword", message: "Add b" });
  });
});
