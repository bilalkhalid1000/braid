import { describe, expect, it } from "vitest";

/** A Windows-style path, built rather than written: a literal backslash in
 *  source is one escape away from meaning something else. */
const win = (path: string) => path.split("/").join(String.fromCharCode(92));

import {
  displayName,
  find,
  forget,
  edit,
  relocate,
  remember,
  rename,
  samePath,
} from "./library";

const list = [
  { path: "E:/Projects/api", name: "" },
  { path: "E:/Projects/web", name: "Storefront" },
];

describe("samePath", () => {
  it("ignores separator style", () => {
    expect(samePath("E:/Projects/api", win("E:/Projects/api"))).toBe(true);
  });

  it("ignores case", () => {
    // The backend's repo id is lowercased on Windows; this has to agree or one
    // repository gets two entries.
    expect(samePath("E:/Projects/API", "e:/projects/api")).toBe(true);
  });

  it("still tells different repositories apart", () => {
    expect(samePath("E:/Projects/api", "E:/Projects/api2")).toBe(false);
  });
});

describe("displayName", () => {
  it("uses the chosen name", () => {
    expect(displayName({ path: "E:/Projects/web", name: "Storefront" })).toBe("Storefront");
  });

  it("falls back to the folder", () => {
    expect(displayName({ path: "E:/Projects/api", name: "" })).toBe("api");
    expect(displayName({ path: "E:/Projects/api", name: "   " })).toBe("api");
  });

  it("is not confused by a trailing separator", () => {
    expect(displayName({ path: "E:/Projects/api/", name: "" })).toBe("api");
    expect(displayName({ path: win("E:/Projects/api/"), name: "" })).toBe("api");
  });
});

describe("remember", () => {
  it("adds a repository", () => {
    expect(remember(list, "E:/Projects/new")).toHaveLength(3);
  });

  it("does not add one twice, whatever the path looks like", () => {
    expect(remember(list, win("e:/projects/api"))).toBe(list);
  });

  it("does not overwrite a name you gave it", () => {
    const again = remember(list, "E:/Projects/web", "Something else");
    expect(find(again, "E:/Projects/web")?.name).toBe("Storefront");
  });
});

describe("rename", () => {
  it("sets a name", () => {
    expect(find(rename(list, "E:/Projects/api", "Backend"), "E:/Projects/api")?.name)
      .toBe("Backend");
  });

  it("an empty name goes back to the folder's own", () => {
    const back = rename(list, "E:/Projects/web", "  ");
    expect(displayName(find(back, "E:/Projects/web")!)).toBe("web");
  });
});

describe("relocate", () => {
  it("points an entry at a new folder", () => {
    const moved = relocate(list, "E:/Projects/api", "D:/Code/api");
    expect(find(moved, "D:/Code/api")?.name).toBe("");
    expect(find(moved, "E:/Projects/api")).toBeUndefined();
  });

  it("keeps the name through the move", () => {
    const moved = relocate(list, "E:/Projects/web", "D:/Code/web");
    expect(find(moved, "D:/Code/web")?.name).toBe("Storefront");
  });

  it("refuses to move onto a path already listed", () => {
    // Otherwise one repository ends up with two entries and the list starts
    // disagreeing with itself.
    expect(relocate(list, "E:/Projects/api", "E:/Projects/web")).toBe(list);
  });

  it("ignores an empty target or a move to itself", () => {
    expect(relocate(list, "E:/Projects/api", "  ")).toBe(list);
    expect(relocate(list, "E:/Projects/api", win("E:/Projects/api"))).toBe(list);
  });
});

describe("forget", () => {
  it("removes an entry", () => {
    expect(forget(list, "E:/Projects/api")).toHaveLength(1);
  });

  it("matches the same way everything else does", () => {
    expect(forget(list, win("e:/projects/api"))).toHaveLength(1);
  });
});

describe("edit", () => {
  it("changes the name and the folder in one step", () => {
    const next = edit(list, "E:/Projects/api", { path: "D:/Code/api", name: "Backend" });

    expect(find(next, "D:/Code/api")).toEqual({ path: "D:/Code/api", name: "Backend" });
    expect(find(next, "E:/Projects/api")).toBeUndefined();
  });

  it("changes only the name when the folder is the same", () => {
    const next = edit(list, "E:/Projects/api", {
      path: win("E:/Projects/api"),
      name: "Backend",
    });

    expect(find(next, "E:/Projects/api")?.name).toBe("Backend");
  });

  it("an empty folder means leave it where it is", () => {
    const next = edit(list, "E:/Projects/api", { path: "  ", name: "Backend" });

    expect(find(next, "E:/Projects/api")?.name).toBe("Backend");
  });

  it("an empty name goes back to the folder's own", () => {
    const next = edit(list, "E:/Projects/web", { path: "E:/Projects/web", name: " " });

    expect(displayName(find(next, "E:/Projects/web")!)).toBe("web");
  });

  it("refuses to move onto a folder already listed, and changes nothing", () => {
    // Not even the name: half an edit is a state nobody asked for.
    const next = edit(list, "E:/Projects/api", {
      path: "E:/Projects/web",
      name: "Backend",
    });

    expect(next).toBe(list);
  });

  it("leaves other entries alone", () => {
    const next = edit(list, "E:/Projects/api", { path: "D:/Code/api", name: "Backend" });

    expect(find(next, "E:/Projects/web")).toEqual(list[1]);
  });
});
