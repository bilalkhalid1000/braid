import { describe, expect, it } from "vitest";

import { everHadTabs, mayWriteSession } from "./session";

describe("everHadTabs", () => {
  it("is false until there is a tab", () => {
    expect(everHadTabs(false, 0)).toBe(false);
  });

  it("becomes true when tabs arrive", () => {
    expect(everHadTabs(false, 3)).toBe(true);
  });

  it("stays true once the tabs are gone again", () => {
    // Closing the last tab is a deliberate empty state, and storing it is
    // right -- unlike the empty state a window starts in.
    expect(everHadTabs(true, 0)).toBe(true);
  });
});

describe("mayWriteSession", () => {
  it("waits for startup to finish", () => {
    expect(mayWriteSession({ settled: false, hadTabs: true })).toBe(false);
  });

  it("refuses to write a window that has never had a tab", () => {
    // The bug: turning "reopen repositories" off skipped the restore but still
    // marked startup finished, so the first write emptied the file and the
    // stored session was gone for good.
    expect(mayWriteSession({ settled: true, hadTabs: false })).toBe(false);
  });

  it("writes once the tabs on screen are the app's own state", () => {
    expect(mayWriteSession({ settled: true, hadTabs: true })).toBe(true);
  });

  it("writes a deliberately empty session", () => {
    // Having closed every tab, the stored session should say so.
    expect(mayWriteSession({ settled: true, hadTabs: everHadTabs(true, 0) })).toBe(true);
  });
});
