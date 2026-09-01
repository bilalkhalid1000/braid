import { describe, expect, it } from "vitest";

import { commandTime, gitCommandLine } from "./useGitLog";

describe("commandTime", () => {
  it("pads every field so the column lines up", () => {
    // Ragged times defeat the point of a left-hand clock column.
    const at = new Date(2026, 0, 2, 3, 4, 5, 6).getTime();
    expect(commandTime(at)).toBe("03:04:05.006");
  });

  it("keeps milliseconds, which is where the answer usually is", () => {
    // Two runs of the same command land in the same second constantly; without
    // milliseconds they look like one.
    const base = new Date(2026, 0, 2, 12, 0, 0, 120).getTime();
    expect(commandTime(base)).not.toBe(commandTime(base + 40));
  });

  it("is 24-hour, so late runs do not sort before early ones by eye", () => {
    const at = new Date(2026, 0, 2, 23, 59, 59, 999).getTime();
    expect(commandTime(at)).toBe("23:59:59.999");
  });
});

describe("gitCommandLine", () => {
  it("writes the command the way you would type it", () => {
    expect(
      gitCommandLine({ id: 1, args: ["status", "--porcelain=v2"], durationMs: 3, code: 0 }),
    ).toBe("git status --porcelain=v2");
  });
});

describe("gitCommandLine escaping", () => {
  const line = (...args: string[]) =>
    gitCommandLine({ id: 1, args, durationMs: 1, code: 0 });

  const UNIT = String.fromCharCode(0x1f);
  const RECORD = String.fromCharCode(0x1e);
  const SLASH = String.fromCharCode(92);

  it("spells out the separators our own formats use", () => {
    // Printed raw these are invisible or arrive as tofu, which is what made
    // `--format=%H%h%an` look corrupted in the log.
    expect(line("--format=%H" + UNIT + "%h" + RECORD)).toBe(
      "git --format=%H" + SLASH + "x1f%h" + SLASH + "x1e",
    );
  });

  it("spells out tabs and newlines by their usual names", () => {
    expect(line("a" + String.fromCharCode(9) + "b")).toContain(SLASH + "t");
    expect(line("a" + String.fromCharCode(10) + "b")).toContain(SLASH + "n");
  });

  it("quotes an argument with spaces, so it reads as one argument", () => {
    expect(line("commit", "-m", "fix the parser")).toBe(
      'git commit -m "fix the parser"',
    );
  });

  it("leaves an ordinary argument alone", () => {
    expect(line("status", "--porcelain=v2")).toBe("git status --porcelain=v2");
  });

  it("escapes a quote inside a quoted argument", () => {
    const quote = String.fromCharCode(34);
    expect(line("-m", 'say ' + quote + 'hello' + quote)).toBe(
      "git -m " + quote + "say " + SLASH + quote + "hello" + SLASH + quote + quote,
    );
  });

  it("keeps an empty argument visible", () => {
    // git takes empty arguments, and one that vanished would make the line a
    // different command from the one that ran.
    expect(line("commit", "-m", "")).toBe('git commit -m ""');
  });
});
