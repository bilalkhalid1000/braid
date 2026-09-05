import { describe, expect, it } from "vitest";

import type { DiffLine } from "./api";
import { pairLines } from "./splitDiff";

const line = (kind: DiffLine["kind"], content: string): DiffLine => ({
  kind,
  content,
  oldLine: null,
  newLine: null,
});

const shape = (rows: ReturnType<typeof pairLines>) =>
  rows.map((row) => [row.left?.line.content ?? "", row.right?.line.content ?? ""]);

describe("pairLines", () => {
  it("puts a change side by side and lets the longer run continue alone", () => {
    const rows = pairLines([
      line("context", "a"),
      line("removed", "b"),
      line("removed", "c"),
      line("added", "B"),
      line("context", "d"),
    ]);

    expect(shape(rows)).toEqual([
      ["a", "a"],
      ["b", "B"],
      ["c", ""],
      ["d", "d"],
    ]);
  });

  it("keeps each side's index into the hunk, which is what staging uses", () => {
    const rows = pairLines([line("removed", "x"), line("added", "y"), line("added", "z")]);

    expect(rows[0]).toEqual({
      left: { index: 0, line: line("removed", "x") },
      right: { index: 1, line: line("added", "y") },
    });
    expect(rows[1]).toEqual({ right: { index: 2, line: line("added", "z") } });
  });

  it("shows an addition with nothing before it on the right alone", () => {
    expect(shape(pairLines([line("context", "a"), line("added", "b")]))).toEqual([
      ["a", "a"],
      ["", "b"],
    ]);
  });
});
