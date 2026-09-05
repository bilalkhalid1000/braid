import { beforeAll, describe, expect, it } from "vitest";

import { ensureGrammar, highlightHunks, highlightLines, languageOf } from "./highlight";

// Grammars load on demand in the app; here every language a test speaks is
// fetched up front, so tokenizing below is the synchronous thing it is there.
beforeAll(async () => {
  for (const language of ["typescript", "tsx", "rust", "json"]) {
    await ensureGrammar(language);
  }
});

const text = (tokens: { text: string }[]) => tokens.map((token) => token.text).join("");

describe("languageOf", () => {
  it("resolves by extension", () => {
    expect(languageOf("src/App.tsx")).toBe("tsx");
    expect(languageOf("src-tauri/src/git/blame.rs")).toBe("rust");
    expect(languageOf("package.json")).toBe("json");
  });

  it("resolves the files whose whole name is the language", () => {
    expect(languageOf("Dockerfile")).toBe("docker");
    expect(languageOf("deploy/Dockerfile")).toBe("docker");
  });

  it("is null for anything we have no grammar for", () => {
    expect(languageOf("notes.xyz")).toBeNull();
    expect(languageOf("LICENSE")).toBeNull();
  });

  it("is not fooled by a dot in a directory name", () => {
    expect(languageOf("some.dir/README")).toBeNull();
  });
});

describe("highlightLines", () => {
  it("returns one entry per line", () => {
    const lines = highlightLines("const a = 1;\nconst b = 2;\n\nconst c = 3;", "typescript");

    expect(lines).toHaveLength(4);
  });

  it("loses no characters", () => {
    // The strongest thing to check: whatever the tokenizer decides, the text
    // that comes back has to be the text that went in, or the view is silently
    // showing something other than the file.
    const source = [
      "export function add(a: number, b: number) {",
      "  // a comment with 'quotes' and a { brace }",
      "  return a + b; // trailing",
      "}",
      "",
      "\tconst indented = `template ${value}`;",
    ].join("\n");

    const lines = highlightLines(source, "typescript")!;

    expect(lines.map(text)).toEqual(source.split("\n"));
  });

  it("keeps a block comment a comment on every one of its lines", () => {
    // The whole reason the file is tokenized in one pass. Line by line, only
    // the first of these would be a comment and the rest would be read as code.
    const source = ["/**", " * middle", " */", "const after = 1;"].join("\n");

    const lines = highlightLines(source, "typescript")!;

    for (const line of lines.slice(0, 3)) {
      expect(line.every((token) => token.type?.includes("comment"))).toBe(true);
    }
    expect(lines[3]!.some((token) => token.type?.includes("keyword"))).toBe(true);
  });

  it("does not let a template literal swallow the rest of the file", () => {
    const source = ["const a = `one", "two`;", "const b = 2;"].join("\n");

    const lines = highlightLines(source, "typescript")!;

    expect(lines).toHaveLength(3);
    expect(lines[2]!.some((token) => token.type?.includes("keyword"))).toBe(true);
  });

  it("gives an empty line an empty list rather than dropping it", () => {
    const lines = highlightLines("a\n\nb", "typescript")!;

    expect(lines).toHaveLength(3);
    expect(lines[1]).toEqual([]);
  });

  it("declines a language it does not know", () => {
    expect(highlightLines("whatever", null)).toBeNull();
    expect(highlightLines("whatever", "klingon")).toBeNull();
  });

  it("declines a file too large to be worth colouring", () => {
    // A vendored bundle should never stall the window for the sake of colour.
    expect(highlightLines("x".repeat(600_000), "typescript")).toBeNull();
  });

  it("handles a file that is only a newline", () => {
    expect(highlightLines("\n", "typescript")).toEqual([[], []]);
  });
});

describe("highlightHunks", () => {
  const hunk = (lines: Array<[string, string]>) => ({
    lines: lines.map(([kind, content]) => ({ kind, content })),
  });

  it("returns an entry for every line, in the same order", () => {
    const result = highlightHunks(
      [hunk([["context", "const a = 1;"], ["removed", "const b = 2;"], ["added", "const b = 3;"]])],
      "typescript",
    )!;

    expect(result[0]).toHaveLength(3);
    expect(result[0]!.map((tokens) => tokens?.map((t) => t.text).join(""))).toEqual([
      "const a = 1;",
      "const b = 2;",
      "const b = 3;",
    ]);
  });

  it("reads each side in its own version of the file", () => {
    // The old side opens a string that the new side does not. Tokenizing the
    // hunk as one document would let one side's syntax leak into the other.
    const result = highlightHunks(
      [hunk([["removed", 'const a = "unclosed'], ["added", "const a = 1;"]])],
      "typescript",
    )!;

    expect(result[0]![1]!.some((t) => t.type?.includes("keyword"))).toBe(true);
  });

  it("does not carry a construct across a hunk boundary", () => {
    // A comment opened in one hunk and never closed must not swallow the next,
    // which is a different part of the file entirely.
    const result = highlightHunks(
      [hunk([["context", "/* opened here"]]), hunk([["context", "const after = 1;"]])],
      "typescript",
    )!;

    expect(result[1]![0]!.some((t) => t.type?.includes("keyword"))).toBe(true);
  });

  it("gives the no-newline marker no tokens at all", () => {
    const result = highlightHunks(
      [hunk([["added", "x"], ["meta", "\\ No newline at end of file"]])],
      "typescript",
    )!;

    expect(result[0]![1]).toBeUndefined();
  });

  it("keeps the sides aligned when they are different lengths", () => {
    const result = highlightHunks(
      [
        hunk([
          ["removed", "one"],
          ["removed", "two"],
          ["added", "uno"],
          ["context", "shared"],
        ]),
      ],
      "typescript",
    )!;

    expect(result[0]!.map((tokens) => tokens?.map((t) => t.text).join(""))).toEqual([
      "one",
      "two",
      "uno",
      "shared",
    ]);
  });

  it("declines when there is no grammar, or too much of it", () => {
    expect(highlightHunks([hunk([["context", "x"]])], null)).toBeNull();
    expect(
      highlightHunks([hunk([["context", "x".repeat(200_000)]])], "typescript"),
    ).toBeNull();
  });
});
