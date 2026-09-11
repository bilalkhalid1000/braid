import { describe, expect, it } from "vitest";

import { arm, disarm, isArmed, isPrefixPress, sequencePrefixes } from "./sequenceGuard";

const press = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("sequencePrefixes", () => {
  it("takes the first key of every sequence and nothing from single chords", () => {
    const prefixes = sequencePrefixes({
      "git.flow": ["G F"],
      "history.top": ["G G"],
      "git.fetch": ["F"],
      "app.palette": ["Mod+P"],
    });
    expect([...prefixes]).toEqual(["G"]);
  });

  it("ignores a sequence that starts with a modifier chord", () => {
    expect(sequencePrefixes({ x: ["Mod+K Mod+S"] }).size).toBe(0);
  });
});

describe("isPrefixPress", () => {
  const prefixes = new Set(["G"]);

  it("matches the bare key in either case", () => {
    expect(isPrefixPress(press("g"), prefixes)).toBe(true);
    expect(isPrefixPress(press("G"), prefixes)).toBe(true);
  });

  it("does not match with a modifier held, or another key", () => {
    expect(isPrefixPress(press("g", { ctrlKey: true }), prefixes)).toBe(false);
    expect(isPrefixPress(press("f"), prefixes)).toBe(false);
  });
});

describe("arming", () => {
  it("stays armed until the timeout, and not after disarm", () => {
    arm(10_000);
    expect(isArmed()).toBe(true);
    disarm();
    expect(isArmed()).toBe(false);
  });

  it("expires on its own", () => {
    arm(-1);
    expect(isArmed()).toBe(false);
  });
});
