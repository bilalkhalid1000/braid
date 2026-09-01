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
