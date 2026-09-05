// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettled } from "./useSettled";

let host: HTMLDivElement;
let root: Root;
let seen: string[] = [];

function Probe({ value }: { value: string }) {
  seen.push(useSettled(value, 100));
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  seen = [];
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useSettled", () => {
  it("follows the value only once it has held still", () => {
    act(() => root.render(<Probe value="a" />));
    act(() => root.render(<Probe value="b" />));
    act(() => root.render(<Probe value="c" />));
    expect(seen[seen.length - 1]).toBe("a");

    act(() => {
      vi.advanceTimersByTime(60);
    });
    act(() => root.render(<Probe value="d" />));
    act(() => {
      vi.advanceTimersByTime(60);
    });
    // Still restless: every change restarted the wait.
    expect(seen[seen.length - 1]).toBe("a");

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(seen[seen.length - 1]).toBe("d");
  });
});
