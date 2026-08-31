import { describe, expect, it } from "vitest";

import { hintFor } from "./gitHints";

describe("hintFor", () => {
  it("offers a pull when a push is rejected as non-fast-forward", () => {
    const hint = hintFor(
      "! [rejected] main -> main (non-fast-forward)\nerror: failed to push some refs",
    );

    expect(hint?.action?.kind).toBe("pull");
  });

  it("recognises the wordier rejection git prints for a behind branch", () => {
    const hint = hintFor(
      "Updates were rejected because the tip of your current branch is behind its remote counterpart.",
    );

    expect(hint?.action?.kind).toBe("pull");
  });

  it("points at the conflicts when a merge stops", () => {
    const hint = hintFor(
      "CONFLICT (content): Merge conflict in src/app.ts\nAutomatic merge failed; fix conflicts and then commit the result.",
    );

    expect(hint?.action?.kind).toBe("resolve");
    expect(hint?.message).toMatch(/resolve/i);
  });

  it("offers a stash when local changes are in the way", () => {
    const hint = hintFor(
      "error: Your local changes to the following files would be overwritten by merge:\n\tsrc/app.ts",
    );

    expect(hint?.action?.kind).toBe("stash");
  });

  it("explains the divergent-branches refusal without offering a guess", () => {
    const hint = hintFor(
      "fatal: Need to specify how to reconcile divergent branches.",
    );

    expect(hint).toBeDefined();
    // There is no right answer between merge and rebase, so no button.
    expect(hint?.action).toBeUndefined();
  });

  it("explains an authentication failure and says the app never prompts", () => {
    const hint = hintFor("fatal: Authentication failed for 'https://example.com/repo.git/'");

    expect(hint?.message).toMatch(/credential/i);
    expect(hint?.action).toBeUndefined();
  });

  it("treats a missing credential prompt as an auth problem, not a crash", () => {
    // This is what a missing helper looks like, because terminal prompting is
    // deliberately disabled.
    const hint = hintFor(
      "fatal: could not read Username for 'https://example.com': terminal prompts disabled",
    );

    expect(hint?.message).toMatch(/authenticate/i);
  });

  it("reports an unreachable remote as a network problem", () => {
    const hint = hintFor("fatal: unable to access 'https://example.com/': Could not resolve host");

    expect(hint?.message).toMatch(/network|reached/i);
  });

  it("explains an unmerged branch rather than suggesting force", () => {
    const hint = hintFor("error: the branch 'feature' is not fully merged.");

    expect(hint?.message).toMatch(/unreachable/i);
    // Forcing is destructive; it must stay a deliberate choice, not a button.
    expect(hint?.action).toBeUndefined();
  });

  it("recognises a stale index lock", () => {
    const hint = hintFor(
      "fatal: Unable to create '.git/index.lock': File exists.\nAnother git process seems to be running",
    );

    expect(hint?.message).toMatch(/index\.lock/);
  });

  it("says the commit message was kept when a hook declines", () => {
    const hint = hintFor("pre-commit hook failed (add --no-verify to bypass)");

    expect(hint?.message).toMatch(/kept/i);
  });

  it("returns nothing for output it does not recognise", () => {
    // An unmatched error must fall through to git's own text rather than be
    // dressed up in a guess.
    expect(hintFor("fatal: something entirely novel happened")).toBeUndefined();
    expect(hintFor("")).toBeUndefined();
  });

  it("prefers the more specific rule when two could match", () => {
    // Mentions both a conflict and unmerged files; the conflict is the event.
    const hint = hintFor(
      "CONFLICT (content): Merge conflict in a.ts\nYou have unmerged files.",
    );

    expect(hint?.message).toMatch(/stopped on conflicting files/i);
  });
});
