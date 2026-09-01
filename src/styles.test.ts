import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

const files = sources("src").map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

/** `title=` on a lowercase tag is a DOM attribute; on a capitalised one it is a
 *  prop being passed to a component, which several here use as a heading. */
const DOM_TITLE = /<[a-z][a-zA-Z0-9]*[^>]*?\stitle=/s;

describe("tooltips", () => {
  it("never uses the browser's own", () => {
    // A native title appears under the cursor, so on a row of buttons the tip
    // for one lands on top of its neighbours, and it can only carry text --
    // which forced shortcuts to be written out as "Merge - M" in some places
    // while being drawn as key caps in others. useTip() is the app's only
    // tooltip so a shortcut looks the same everywhere it appears.
    const guilty = files.filter((file) => DOM_TITLE.test(file.text));

    expect(guilty.map((file) => file.path)).toEqual([]);
  });
});

describe("utilities that do not mean what they look like", () => {
  it("never uses bg-none where bg-transparent is meant", () => {
    // bg-none sets background-image, not background-color. Tailwind's preflight
    // would have made that harmless by clearing every button's background
    // anyway -- but preflight is deliberately not imported while the legacy
    // stylesheet is still here, so a button written with bg-none keeps the
    // browser's default grey and renders as a filled box.
    const guilty = files.filter((file) => /\bbg-none\b/.test(file.text));

    expect(guilty.map((file) => file.path)).toEqual([]);
  });
});
