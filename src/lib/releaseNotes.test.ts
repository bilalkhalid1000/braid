import { describe, expect, it } from "vitest";

import { summarise } from "./releaseNotes";

/** What our own release workflow writes, verbatim. */
const OURS = `**This is a prerelease.** Expect rough edges, and keep a backup of anything you cannot lose.

Download the installer for your platform below.
`;

describe("summarise", () => {
  it("strips the markup our own release notes arrive with", () => {
    // The banner rendered this with the asterisks showing.
    expect(summarise(OURS)).toBe(
      "This is a prerelease. Expect rough edges, and keep a backup of anything you cannot lose.",
    );
  });

  it("takes the first line that says something", () => {
    expect(summarise("\n\n   \nFixed the thing.\nAnd another.")).toBe("Fixed the thing.");
  });

  it("skips a heading, because every set of notes has one", () => {
    expect(summarise("## What's new\n\nBlame now works on submodules.")).toBe(
      "Blame now works on submodules.",
    );
  });

  it("falls back to the heading when there is nothing else", () => {
    expect(summarise("# Bug fixes")).toBe("Bug fixes");
  });

  it("unwraps a bullet into a sentence", () => {
    expect(summarise("- Push now reports progress.")).toBe("Push now reports progress.");
    expect(summarise("1. First thing.")).toBe("First thing.");
  });

  it("keeps a link's words and drops its URL", () => {
    expect(summarise("See [the changelog](https://example.com/x) for the rest.")).toBe(
      "See the changelog for the rest.",
    );
  });

  it("drops an image outright", () => {
    // A badge at the top of the notes is not a summary of them.
    expect(summarise("![build](https://example.com/b.svg)\n\nReal news here.")).toBe(
      "Real news here.",
    );
  });

  it("unwraps code, bold and italic", () => {
    expect(summarise("`git blame` is now *much* __faster__.")).toBe(
      "git blame is now much faster.",
    );
  });

  it("ignores a horizontal rule", () => {
    expect(summarise("---\n\nThe actual note.")).toBe("The actual note.");
  });

  it("unwraps a blockquote", () => {
    expect(summarise("> Heads up: the config moved.")).toBe("Heads up: the config moved.");
  });

  it("drops an HTML comment", () => {
    expect(summarise("<!-- generated -->\nThe note.")).toBe("The note.");
  });

  it("collapses the whitespace a wrapped line leaves behind", () => {
    expect(summarise("Two   spaces\tand a tab.")).toBe("Two spaces and a tab.");
  });

  it("leaves an unmatched asterisk alone rather than eating the sentence", () => {
    // Half-understood markup must not cost the reader the words around it.
    expect(summarise("A 5 * 3 grid.")).toBe("A 5 * 3 grid.");
  });

  it("has nothing to say about empty notes", () => {
    expect(summarise("")).toBe("");
    expect(summarise("\n\n  \n")).toBe("");
  });
});
