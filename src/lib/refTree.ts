/** Grouping slash-separated ref names into folders.
 *
 *  `feature/login` and `feature/signup` are two branches, but they are one
 *  thing in the way people talk about them, and a repository with forty of them
 *  turns the sidebar into a wall of near-identical names. Git already puts the
 *  structure in the name; this reads it back out.
 */

export type RefNode<T> =
  | { kind: "leaf"; path: string; label: string; item: T }
  | { kind: "folder"; path: string; label: string; children: RefNode<T>[] };

interface Entry<T> {
  segments: string[];
  item: T;
}

/**
 * Group items by the slash-separated parts of their names.
 *
 * Order is preserved: names arrive from git already sorted, and a folder takes
 * the position of the first name that put it there. Sorting again here would
 * only disagree with every other list in the app.
 */
export function groupRefs<T>(items: T[], nameOf: (item: T) => string): RefNode<T>[] {
  return build(
    items.map((item) => ({
      // A leading or doubled slash would otherwise produce a folder with no
      // name, which is unreachable in the UI.
      segments: nameOf(item).split("/").filter((part) => part !== ""),
      item,
    })),
    "",
  );
}

function build<T>(entries: Entry<T>[], prefix: string): RefNode<T>[] {
  const order: string[] = [];
  const leaves = new Map<string, T>();
  const folders = new Map<string, Entry<T>[]>();

  for (const entry of entries) {
    const head = entry.segments[0];
    if (head === undefined) continue;

    if (!leaves.has(head) && !folders.has(head)) order.push(head);

    if (entry.segments.length === 1) {
      leaves.set(head, entry.item);
    } else {
      const rest = folders.get(head) ?? [];
      rest.push({ segments: entry.segments.slice(1), item: entry.item });
      folders.set(head, rest);
    }
  }

  return order.flatMap((head) => {
    const path = prefix + head;
    const nodes: RefNode<T>[] = [];

    // git will not let a ref be both `feature` and `feature/login`, so these are
    // exclusive in practice. Handling both costs one line and means a strange
    // repository renders instead of losing a ref.
    const leaf = leaves.get(head);
    if (leaf !== undefined) {
      nodes.push({ kind: "leaf", path, label: head, item: leaf });
    }

    const children = folders.get(head);
    if (children) {
      nodes.push({
        kind: "folder",
        path,
        label: head,
        children: build(children, `${path}/`),
      });
    }

    return nodes;
  });
}

/** Everything currently on screen, folders included, in display order.
 *
 *  Keyboard navigation walks this rather than the original list. Two things
 *  follow from that, and both matter: a name inside a collapsed folder is not
 *  here, because stepping onto it would move the cursor to nothing; and the
 *  folders themselves *are* here, because otherwise a closed folder is a wall —
 *  no way to reach it, so no way to open it, so no way to reach anything inside
 *  it without the mouse. */
export function visibleNodes<T>(
  nodes: RefNode<T>[],
  isCollapsed: (path: string) => boolean,
): RefNode<T>[] {
  return nodes.flatMap((node) =>
    node.kind === "leaf"
      ? [node]
      : isCollapsed(node.path)
        ? [node]
        : [node, ...visibleNodes(node.children, isCollapsed)],
  );
}

/** Whether anything here is nested, so a flat list can skip the tree entirely. */
export function hasFolders<T>(nodes: RefNode<T>[]): boolean {
  return nodes.some((node) => node.kind === "folder");
}

/** How many refs a folder holds, however deep.
 *
 *  Shown beside the folder the way a section shows its count, so the right
 *  gutter means one thing all the way down: what is inside. */
export function leafCount<T>(node: RefNode<T>): number {
  if (node.kind === "leaf") return 1;
  return node.children.reduce((sum, child) => sum + leafCount(child), 0);
}
