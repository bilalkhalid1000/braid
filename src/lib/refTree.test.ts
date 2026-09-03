import { describe, expect, it } from "vitest";

import { groupRefs, hasFolders, visibleNodes, type RefNode, leafCount } from "./refTree";

const name = (n: string) => n;
const tree = (names: string[]) => groupRefs(names, name);

/** A readable shape to assert against: "feature/" for a folder, "main" for a leaf. */
const shape = (nodes: RefNode<string>[]): unknown[] =>
  nodes.map((node) =>
    node.kind === "leaf" ? node.label : { [`${node.label}/`]: shape(node.children) },
  );

describe("groupRefs", () => {
  it("leaves names without a slash alone", () => {
    expect(shape(tree(["main", "develop", "stage"]))).toEqual(["main", "develop", "stage"]);
  });

  it("gathers a shared prefix into one folder", () => {
    expect(shape(tree(["feature/login", "feature/signup", "main"]))).toEqual([
      { "feature/": ["login", "signup"] },
      "main",
    ]);
  });

  it("nests as deeply as the name does", () => {
    expect(shape(tree(["feature/team/login", "feature/team/signup", "feature/solo"]))).toEqual([
      { "feature/": [{ "team/": ["login", "signup"] }, "solo"] },
    ]);
  });

  it("makes a folder even for a single branch, so the prefix reads the same everywhere", () => {
    expect(shape(tree(["hotfix/1.0.1", "main"]))).toEqual([
      { "hotfix/": ["1.0.1"] },
      "main",
    ]);
  });

  it("keeps the order it was given", () => {
    // Refs arrive from git already sorted. Re-sorting here would only disagree
    // with every other list in the app.
    expect(shape(tree(["zeta", "feature/b", "alpha", "feature/a"]))).toEqual([
      "zeta",
      { "feature/": ["b", "a"] },
      "alpha",
    ]);
  });

  it("puts a folder where its first member appeared", () => {
    expect(shape(tree(["release/1", "main", "release/2"]))).toEqual([
      { "release/": ["1", "2"] },
      "main",
    ]);
  });

  it("carries the original item, not just the name", () => {
    const branches = [{ name: "feature/login", head: true }];
    const nodes = groupRefs(branches, (b) => b.name);

    const folder = nodes[0]!;
    expect(folder.kind).toBe("folder");
    if (folder.kind !== "folder") return;

    const leaf = folder.children[0]!;
    expect(leaf.kind).toBe("leaf");
    if (leaf.kind !== "leaf") return;

    expect(leaf.item).toBe(branches[0]);
    expect(leaf.path).toBe("feature/login");
    expect(leaf.label).toBe("login");
  });

  it("survives names that are all slashes or empty", () => {
    expect(shape(tree(["//", ""]))).toEqual([]);
    expect(shape(tree(["/leading"]))).toEqual(["leading"]);
  });

  it("handles a name being both a leaf and a folder", () => {
    // git forbids this, but losing a ref over it would be worse than showing
    // both.
    expect(shape(tree(["feature", "feature/login"]))).toEqual([
      "feature",
      { "feature/": ["login"] },
    ]);
  });

  it("is empty for no refs", () => {
    expect(tree([])).toEqual([]);
  });
});

describe("visibleNodes", () => {
  const nodes = tree(["feature/login", "feature/signup", "main"]);
  const labels = (result: RefNode<string>[]) =>
    result.map((node) => (node.kind === "folder" ? `${node.label}/` : node.item));

  it("walks folders and names alike when nothing is collapsed", () => {
    expect(labels(visibleNodes(nodes, () => false))).toEqual([
      "feature/",
      "feature/login",
      "feature/signup",
      "main",
    ]);
  });

  it("keeps a collapsed folder but drops what it hides", () => {
    // The folder has to stay reachable. Without it a closed folder is a wall:
    // no way to land on it, so no way to open it, so no way to reach anything
    // inside it from the keyboard at all.
    expect(labels(visibleNodes(nodes, (path) => path === "feature"))).toEqual([
      "feature/",
      "main",
    ]);
  });

  it("drops a whole subtree when an outer folder closes", () => {
    const deep = tree(["a/b/c", "a/b/d", "top"]);

    expect(labels(visibleNodes(deep, (path) => path === "a"))).toEqual(["a/", "top"]);
    // The label is the last segment, so the inner folder reads "b/" -- the
    // full path is what `path` matches on, not what is shown.
    expect(labels(visibleNodes(deep, (path) => path === "a/b"))).toEqual([
      "a/",
      "b/",
      "top",
    ]);
  });
});

describe("hasFolders", () => {
  it("tells a flat list from a nested one", () => {
    expect(hasFolders(tree(["main", "develop"]))).toBe(false);
    expect(hasFolders(tree(["feature/login"]))).toBe(true);
  });
});

describe("leafCount", () => {
  it("counts the refs inside a folder, however deep", () => {
    const tree = groupRefs(["a/one", "a/two", "a/deep/three", "b"], (name) => name);
    const a = tree.find((node) => node.kind === "folder" && node.label === "a")!;

    expect(leafCount(a)).toBe(3);
  });

  it("counts a ref on its own as one", () => {
    const [b] = groupRefs(["b"], (name) => name);

    expect(leafCount(b!)).toBe(1);
  });
});
