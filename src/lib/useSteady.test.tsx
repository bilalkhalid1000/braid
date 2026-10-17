// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSteady } from "./useSteady";

let host: HTMLDivElement;
let root: Root;
let shown: string | null = null;

function Probe({ value }: { value: string | null }) {
  shown = useSteady(value, 250, 400);
  return null;
}

const render = (value: string | null) => act(() => root.render(<Probe value={value} />));
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  shown = null;
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useSteady", () => {
  it("never shows a call that finishes quickly", () => {
    render("git status");
    advance(100);
    render(null);
    advance(1000);

    expect(shown).toBeNull();
  });

  it("shows a slow call, and follows it while it is up", () => {
    render("git fetch");
    advance(249);
    expect(shown).toBeNull();
    advance(1);
    expect(shown).toBe("git fetch");

    render("git log");
    expect(shown).toBe("git log");
  });

  it("holds the last line a while after the calls stop", () => {
    render("git fetch");
    advance(300);
    render(null);
    advance(399);
    expect(shown).toBe("git fetch");
    advance(1);
    expect(shown).toBeNull();
  });

  it("reads a run of calls with gaps between as one", () => {
    render("git fetch");
    advance(300);
    for (const next of ["git status", "git log", "git for-each-ref"]) {
      render(null);
      advance(50);
      render(next);
      expect(shown).toBe(next);
    }
  });
});
