import { describe, expect, it } from "vitest";

import { customKeymap, fill, normalizeCustomCommands } from "./customCommands";

describe("fill", () => {
  it("substitutes known placeholders and leaves unknown ones visible", () => {
    expect(fill("git push {{remote}} {{ branch }} --{{typo}}", { remote: "origin", branch: "dev" }))
      .toBe("git push origin dev --{{typo}}");
  });

  it("reaches prompt answers by dotted name", () => {
    expect(fill("echo {{prompt.message}}", { "prompt.message": "hi" })).toBe("echo hi");
  });
});

describe("customKeymap", () => {
  it("claims keys for global commands only, by position", () => {
    const keymap = customKeymap([
      { label: "a", command: "a", context: "global", key: "Shift+X" },
      { label: "b", command: "b", context: "branch", key: "Shift+Y" },
      { label: "c", command: "c", context: "global" },
      { label: "d", command: "d", context: "global", key: " Mod+Shift+D " },
    ]);

    expect(keymap).toEqual({ "custom.0": ["Shift+X"], "custom.3": ["Mod+Shift+D"] });
  });
});

describe("normalizeCustomCommands", () => {
  it("keeps what is usable and drops the rest", () => {
    const commands = normalizeCustomCommands([
      { label: "Fine", command: "echo ok", context: "commit" },
      { label: "No command", context: "global" },
      { label: "Bad context", command: "x", context: "planet" },
      "not an object",
      {
        label: "With prompts",
        command: "echo {{prompt.what}}",
        context: "global",
        prompts: [{ key: "what", options: ["a", 1, "b"] }, { label: "no key" }],
        confirm: "Sure?",
      },
    ]);

    expect(commands.map((c) => c.label)).toEqual(["Fine", "Bad context", "With prompts"]);
    expect(commands[1]!.context).toBe("global");
    expect(commands[2]!.prompts).toEqual([{ key: "what", label: "what", options: ["a", "b"], value: undefined }]);
    expect(commands[2]!.confirm).toBe("Sure?");
  });

  it("is empty for anything that is not a list", () => {
    expect(normalizeCustomCommands(undefined)).toEqual([]);
    expect(normalizeCustomCommands({})).toEqual([]);
  });
});
