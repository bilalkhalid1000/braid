import { describe, expect, it } from "vitest";

import type { DiffLine } from "./api";
import { diffTokens, markHunk, tokenize } from "./intraline";

const line = (kind: DiffLine["kind"], content: string): DiffLine => ({
  kind,
  content,
  oldLine: null,
  newLine: null,
});

/** The marked text of a line, for reading a result. */
const marked = (text: string, ranges: { start: number; end: number }[] | undefined) =>
  (ranges ?? []).map((r) => text.slice(r.start, r.end));

describe("tokenize", () => {
  it("splits into words, whitespace runs and single punctuation", () => {
    expect(tokenize("const x = foo(1);")).toEqual([
      "const", " ", "x", " ", "=", " ", "foo", "(", "1", ")", ";",
    ]);
  });
});

describe("diffTokens", () => {
  it("marks only the token that changed, on both sides", () => {
    const result = diffTokens("const timer = 8000;", "const timer = BOOT_BUDGET_MS;")!;
    expect(marked("const timer = 8000;", result.a)).toEqual(["8000"]);
    expect(marked("const timer = BOOT_BUDGET_MS;", result.b)).toEqual(["BOOT_BUDGET_MS"]);
  });

  it("joins adjacent changed tokens into one range", () => {
    const result = diffTokens("return a;", "return a + b;")!;
    expect(marked("return a + b;", result.b)).toEqual([" + b"]);
    expect(result.a).toEqual([]);
  });

  it("gives up on a pair too large to compare", () => {
    const huge = "x ".repeat(600);
    expect(diffTokens(huge, huge + "y")).toBeNull();
  });
});

describe("markHunk", () => {
  it("pairs a removed run with the added run that follows it", () => {
    const marks = markHunk([
      line("context", "fn main() {"),
      line("removed", "  let x = 1;"),
      line("removed", "  let y = 2;"),
      line("added", "  let x = 10;"),
      line("added", "  let y = 20;"),
      line("context", "}"),
    ]);

    expect(marked("  let x = 1;", marks.get(1))).toEqual(["1"]);
    expect(marked("  let x = 10;", marks.get(3))).toEqual(["10"]);
    expect(marked("  let y = 2;", marks.get(2))).toEqual(["2"]);
    expect(marked("  let y = 20;", marks.get(4))).toEqual(["20"]);
    expect(marks.has(0)).toBe(false);
  });

  it("leaves a rewritten line whole rather than marking what survived", () => {
    const marks = markHunk([
      line("removed", "return null;"),
      line("added", "throw new Error('nothing here to return');"),
    ]);
    expect(marks.size).toBe(0);
  });

  it("leaves a pure insertion or deletion unmarked", () => {
    expect(markHunk([line("added", "new line")]).size).toBe(0);
    expect(markHunk([line("removed", "old line")]).size).toBe(0);
  });

  it("marks only the paired lines when the runs differ in length", () => {
    const marks = markHunk([
      line("removed", "a = 1"),
      line("added", "a = 2"),
      line("added", "b = 3"),
    ]);
    expect(marked("a = 1", marks.get(0))).toEqual(["1"]);
    expect(marked("a = 2", marks.get(1))).toEqual(["2"]);
    expect(marks.has(2)).toBe(false);
  });
});
