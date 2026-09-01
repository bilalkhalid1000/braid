import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";

import { IconChevron } from "./icons";
import { FilterInput, matchesFilter } from "./FilterInput";
import { useCommands } from "../lib/useCommands";
import { useSettings } from "../lib/settings";
import { shortcutLabel } from "../lib/shortcutLabel";
import { groupRefs, hasFolders, visibleNodes, type RefNode } from "../lib/refTree";
import { Keys } from "./Keys";
import { useTip } from "./Tip";
import {
  submoduleLabel,
  type BranchRef,
  type RefsSnapshot,
  type RepoStatus,
  type StashEntry,
  type Submodule,
  type Worktree,
} from "../lib/api";

export type WorkspaceView = "status" | "history";

/** The regions a number key jumps to, in the order those keys run.
 *
 *  Files and History are the main panel; the rest live in the sidebar. Keeping
 *  them in one list is what makes the numbering honest: 1 through 7 with no
 *  gaps, because every one of them is somewhere you can actually land. */
export const PANELS = [
  "files",
  "history",
  "branches",
  "remotes",
  "stashes",
  "worktrees",
  "submodules",
] as const;

export type PanelId = (typeof PANELS)[number];

export const SIDEBAR_PANELS: PanelId[] = [
  "branches",
  "remotes",
  "stashes",
  "worktrees",
  "submodules",
];

export const isSidebarPanel = (panel: PanelId) => SIDEBAR_PANELS.includes(panel);

export const panelNumber = (panel: PanelId) => PANELS.indexOf(panel) + 1;

/** What was acted on. The sidebar reports it; App decides what it means. */
export type MenuTarget =
  | { kind: "branch"; branch: BranchRef }
  | { kind: "remote"; remote: string; branch: string }
  | { kind: "tag"; tag: string }
  | { kind: "stash"; stash: StashEntry }
  | { kind: "worktree"; worktree: Worktree }
  | { kind: "submodule"; submodule: Submodule };

export interface Point {
  x: number;
  y: number;
}

interface Props {
  refs: RefsSnapshot | undefined;
  status: RepoStatus | undefined;
  worktrees: Worktree[] | undefined;
  submodules: Submodule[] | undefined;
  view: WorkspaceView;
  focusedPanel: PanelId;
  /** False while a dialog or the palette holds the keyboard. */
  keyboardActive: boolean;
  onFocusPanel: (panel: PanelId) => void;
  onCheckout: (name: string) => void;
  onPublish: (name: string) => void;
  onStash: (selector: string, action: "apply" | "pop" | "drop") => void;
  onOpenPath: (path: string) => void;
  onNewBranch: () => void;
  onAddWorktree: () => void;
  onRemoveWorktree: (path: string) => void;
  onPruneWorktrees: () => void;
  onUpdateSubmodule: (path: string) => void;
  onUpdateAllSubmodules: () => void;
  onMenu: (target: MenuTarget, at: Point) => void;
  /** What the keyboard cursor is on, so a command outside the sidebar can
   *  act on it instead of opening an empty prompt. */
  onCursor?: (target: MenuTarget | null) => void;
  /** Delete whatever the cursor is on. Which things can be deleted, and what
   *  deleting one means, is decided where the git actions live. */
  onDelete: (target: MenuTarget | null) => void;
}

/** One row the keyboard can land on. */
interface Row {
  key: string;
  activate: () => void;
  menu: (at: Point) => void;
  /** What this row points at, for commands that act on the cursor rather than
   *  asking. A folder points at nothing. */
  target?: MenuTarget;
}

export function Sidebar({
  refs,
  status,
  worktrees,
  submodules,
  view,
  focusedPanel,
  keyboardActive,
  onFocusPanel,
  onCheckout,
  onPublish,
  onStash,
  onOpenPath,
  onNewBranch,
  onAddWorktree,
  onRemoveWorktree,
  onPruneWorktrees,
  onUpdateSubmodule,
  onUpdateAllSubmodules,
  onMenu,
  onCursor,
  onDelete,
}: Props) {
  const { keymap } = useSettings();
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(0);
  const open = filter !== "";

  /** Folders the user has closed, keyed by section so "feature" under branches
   *  and "feature" under tags are not the same fold. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const isCollapsed = (key: string) => collapsed.has(key);
  const toggleFolder = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const focused = isSidebarPanel(focusedPanel) ? focusedPanel : null;

  const pending =
    (status?.stagedCount ?? 0) + (status?.unstagedCount ?? 0) + (status?.untrackedCount ?? 0);

  // Filtering searches everything git-named at once: branches, tags, remote
  // branches and stash descriptions. Typing "login" should find the branch
  // whether it is local or on a remote, without first picking a section.
  const shown = useMemo(() => {
    const branches = (refs?.branches ?? []).filter((b) => matchesFilter(b.name, filter));
    const tags = (refs?.tags ?? []).filter((t) => matchesFilter(t, filter));
    const stashes = (refs?.stashes ?? []).filter((s) => matchesFilter(s.message, filter));

    const remotes = (refs?.remotes ?? [])
      .map((remote) => ({
        ...remote,
        branches: remote.branches.filter((b) =>
          matchesFilter(`${remote.name}/${b}`, filter),
        ),
      }))
      .filter((remote) => remote.branches.length > 0);

    const count =
      branches.length +
      tags.length +
      stashes.length +
      remotes.reduce((sum, r) => sum + r.branches.length, 0);

    return { branches, tags, stashes, remotes, count };
  }, [refs, filter]);

  // Git puts the structure in the name; this reads it back out, so forty
  // feature branches are one row until you want them.
  const branchTree = useMemo(
    () => groupRefs(shown.branches, (branch) => branch.name),
    [shown.branches],
  );
  const tagTree = useMemo(() => groupRefs(shown.tags, (tag) => tag), [shown.tags]);

  /** The disclosure column costs every row in the section 20px of indent, so it
   *  is only reserved where something is actually grouped. A repository with no
   *  slashes in its branch names looks exactly as it did before. */
  const twisty = (present: boolean) =>
    present ? <span className="side-twisty" /> : undefined;

  const branchesGrouped = hasFolders(branchTree);
  const tagsGrouped = hasFolders(tagTree);

  // A filter opens every folder: a match hidden inside a closed one reads as no
  // match at all.
  const folded = (section: string) => (path: string) =>
    !open && isCollapsed(`${section}:${path}`);

  /** The rows of whichever panel currently has focus, in display order. */
  const rows: Row[] = useMemo(() => {
    if (focused === "branches") {
      // What is on screen, not every branch. A name inside a closed folder is
      // not a stop -- the cursor would move to nothing -- and the folders
      // themselves are stops, or a closed one could never be opened without
      // reaching for the mouse.
      return visibleNodes(branchTree, folded("branch")).map<Row>((node) =>
        node.kind === "folder"
          ? {
              key: `branch-folder:${node.path}`,
              activate: () => toggleFolder(`branch:${node.path}`),
              menu: () => {},
            }
          : {
              key: `branch:${node.item.name}`,
              activate: () => !node.item.isHead && onCheckout(node.item.name),
              menu: (at: Point) => onMenu({ kind: "branch", branch: node.item }, at),
              target: { kind: "branch", branch: node.item },
            },
      );
    }

    if (focused === "remotes") {
      return shown.remotes.flatMap((remote) =>
        remote.branches.map((branch) => ({
          key: `remote:${remote.name}/${branch}`,
          activate: () => onCheckout(branch),
          menu: (at: Point) => onMenu({ kind: "remote", remote: remote.name, branch }, at),
          target: { kind: "remote", remote: remote.name, branch },
        })),
      );
    }

    if (focused === "stashes") {
      return shown.stashes.map((stash) => ({
        key: `stash:${stash.selector}`,
        activate: () => onStash(stash.selector, "pop"),
        menu: (at: Point) => onMenu({ kind: "stash", stash }, at),
      }));
    }

    if (focused === "worktrees") {
      return (worktrees ?? []).map((worktree) => ({
        key: `worktree:${worktree.path}`,
        activate: () => onOpenPath(worktree.path),
        menu: (at: Point) => onMenu({ kind: "worktree", worktree }, at),
        target: { kind: "worktree", worktree },
      }));
    }

    if (focused === "submodules") {
      return (submodules ?? []).map((submodule) => ({
        key: `submodule:${submodule.path}`,
        activate: () =>
          submodule.state === "uninitialized"
            ? onUpdateSubmodule(submodule.path)
            : onOpenPath(submodule.path),
        menu: (at: Point) => onMenu({ kind: "submodule", submodule }, at),
        target: { kind: "submodule", submodule },
      }));
    }

    return [];
    // `branchTree` and `collapsed` are here because folding a group changes
    // which rows exist. Without them the cursor keeps walking a list from
    // before the fold and lands on branches that are no longer on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, shown, worktrees, submodules, branchTree, collapsed, open]);

  // Landing on a panel starts at the top, and a list that shrank under the
  // cursor pulls it back into range rather than leaving nothing selected.
  useEffect(() => setIndex(0), [focused]);
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  const selectedKey = focused ? rows[index]?.key : undefined;

  // Reported upward so a command bound outside the sidebar can act on what the
  // cursor is on. Null while no sidebar panel has focus, so those commands fall
  // back to asking rather than acting on a stale highlight.
  const cursorTarget = (focused ? rows[index]?.target : undefined) ?? null;
  useEffect(() => onCursor?.(cursorTarget), [cursorTarget, onCursor]);

  useEffect(() => {
    if (!selectedKey) return;
    document
      .querySelector(`[data-row="${CSS.escape(selectedKey)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  /** Where a menu opens when a key asked for it rather than a click. */
  const anchorOf = (key: string): Point => {
    const element = document.querySelector(`[data-row="${CSS.escape(key)}"]`);
    const box = element?.getBoundingClientRect();
    return box ? { x: box.right - 24, y: box.bottom } : { x: 240, y: 200 };
  };

  useCommands(
    {
      "sidebar.next": () => setIndex((i) => Math.min(i + 1, rows.length - 1)),
      "sidebar.previous": () => setIndex((i) => Math.max(i - 1, 0)),
      "sidebar.activate": () => rows[index]?.activate(),
      "sidebar.menu": () => {
        const row = rows[index];
        if (row) row.menu(anchorOf(row.key));
      },
      // Reported even when the row points at nothing -- a folder, say. A key
      // that silently does nothing is indistinguishable from one that is not
      // bound, which is exactly how this looked.
      "sidebar.delete": () => onDelete(rows[index]?.target ?? null),
      "sidebar.leave": () => onFocusPanel(view === "history" ? "history" : "files"),
    },
    // Escape belongs to whatever is on top: without this the sidebar would
    // also answer it from behind an open dialog.
    focused !== null && keyboardActive,
  );

  const rowProps = (key: string) => ({
    "data-row": key,
    className: selectedKey === key ? "side-item side-item-cursor" : "side-item",
  });

  /** The same, for a folder row. It carries `data-row` for the same reason a
   *  branch does: the cursor scrolls itself into view by querying for it. */
  const folderProps = (key: string) => ({
    "data-row": key,
    className: selectedKey === key ? "side-folder side-folder-cursor" : "side-folder",
  });

  return (
    <nav className={`sidebar ${focused ? "sidebar-focused" : ""}`}>
      <div className="sidebar-filter">
        <FilterInput
          value={filter}
          onChange={setFilter}
          name="sidebar"
          placeholder="Filter branches and tags"
          matches={shown.count}
        />
      </div>

      <Section title="Workspace" defaultOpen>
        <Item
          label="File Status"
          active={view === "status"}
          number={panelNumber("files")}
          badge={pending || undefined}
          onClick={() => onFocusPanel("files")}
        />
        <Item
          label="History"
          active={view === "history"}
          number={panelNumber("history")}
          onClick={() => onFocusPanel("history")}
        />
      </Section>

      <Section
        title="Branches"
        defaultOpen
        count={shown.branches.length}
        forceOpen={open || focused === "branches"}
        number={panelNumber("branches")}
        focused={focused === "branches"}
        action={{
          label: "new",
          title: "New branch",
          command: "git.new",
          onClick: onNewBranch,
        }}
      >
        <RefTree
          nodes={branchTree}
          isFolded={folded("branch")}
          onToggle={(path) => toggleFolder(`branch:${path}`)}
          folderProps={(path) => folderProps(`branch-folder:${path}`)}
          renderLeaf={(branch, label) => (
          <Item
            key={branch.name}
            {...rowProps(`branch:${branch.name}`)}
            leading={twisty(branchesGrouped)}
            label={label}
            active={branch.isHead}
            bold={branch.isHead}
            title={
              branch.isHead
                ? `${branch.name} (current)`
                : `${branch.name} – double-click or Enter to check out`
            }
            onDoubleClick={() => onCheckout(branch.name)}
            onContextMenu={(e) => onMenu({ kind: "branch", branch }, { x: e.clientX, y: e.clientY })}
            trailing={
              <>
                <Tracking branch={branch} />
                {branch.upstream ? (
                  !branch.isHead && (
                    <LinkAction
                      label="checkout"
                      title={`Check out ${branch.name}`}
                      hoverOnly
                      onClick={() => onCheckout(branch.name)}
                    />
                  )
                ) : (
                  // Publishing displaces checkout on an unpublished branch: it
                  // is the thing that branch is missing, and the row has room
                  // for one action.
                  <LinkAction
                    label="publish"
                    title={`Push ${branch.name} and track it`}
                    hoverOnly
                    onClick={() => onPublish(branch.name)}
                  />
                )}
              </>
            }
          />
          )}
        />
      </Section>

      <Section title="Tags" count={shown.tags.length} forceOpen={open}>
        <RefTree
          nodes={tagTree}
          isFolded={folded("tag")}
          onToggle={(path) => toggleFolder(`tag:${path}`)}
          folderProps={(path) => folderProps(`tag-folder:${path}`)}
          renderLeaf={(tag, label) => (
            <Item
              key={tag}
              leading={twisty(tagsGrouped)}
              label={label}
              title={tag}
              onContextMenu={(e) => onMenu({ kind: "tag", tag }, { x: e.clientX, y: e.clientY })}
            />
          )}
        />
      </Section>

      <Section
        title="Remotes"
        count={shown.remotes.length}
        forceOpen={open || focused === "remotes"}
        number={panelNumber("remotes")}
        focused={focused === "remotes"}
      >
        {shown.remotes.map((remote) => (
          <Section
            key={remote.name}
            title={remote.name}
            nested
            count={remote.branches.length}
            forceOpen={open || focused === "remotes"}
          >
            {remote.branches.map((branch) => (
              <Item
                key={branch}
                {...rowProps(`remote:${remote.name}/${branch}`)}
                label={branch}
                nested
                title={`${remote.name}/${branch} – double-click or Enter to check out`}
                // Checking out a remote branch by its short name lets git set
                // up tracking itself, which is what the user means by it.
                onDoubleClick={() => onCheckout(branch)}
                onContextMenu={(e) =>
                  onMenu(
                    { kind: "remote", remote: remote.name, branch },
                    { x: e.clientX, y: e.clientY },
                  )
                }
                trailing={
                  <LinkAction
                    label="checkout"
                    title={`Check out ${branch} tracking ${remote.name}/${branch}`}
                    hoverOnly
                    onClick={() => onCheckout(branch)}
                  />
                }
              />
            ))}
          </Section>
        ))}
      </Section>

      <Section
        title="Stashes"
        count={shown.stashes.length}
        forceOpen={open || focused === "stashes"}
        number={panelNumber("stashes")}
        focused={focused === "stashes"}
      >
        {shown.stashes.map((stash) => (
          <Item
            key={stash.selector}
            {...rowProps(`stash:${stash.selector}`)}
            label={stash.message}
            title={`${stash.selector} – Enter to pop`}
            onDoubleClick={() => onStash(stash.selector, "pop")}
            onContextMenu={(e) =>
              onMenu({ kind: "stash", stash }, { x: e.clientX, y: e.clientY })
            }
            trailing={
              <LinkAction
                label="drop"
                title="Drop this stash"
                hoverOnly
                onClick={() => onStash(stash.selector, "drop")}
              />
            }
          />
        ))}
      </Section>

      {/* Always present, even for the ordinary single-worktree repository:
          a section that appears only once you already have worktrees is a
          section nobody discovers. */}
      <Section
        title="Worktrees"
        defaultOpen
        count={worktrees?.length}
        forceOpen={focused === "worktrees"}
        number={panelNumber("worktrees")}
        focused={focused === "worktrees"}
        action={{
          label: "add",
          title: "Add a worktree",
          command: "git.worktree",
          onClick: onAddWorktree,
        }}
      >
        {worktrees?.length === 0 && <Empty>No worktrees</Empty>}
        {worktrees?.map((worktree) => (
          <Item
            key={worktree.path}
            {...rowProps(`worktree:${worktree.path}`)}
            label={leaf(worktree.path)}
            title={`${worktree.path}\n${worktreeSubtitle(worktree)}`}
            bold={worktree.isMain}
            onDoubleClick={() => onOpenPath(worktree.path)}
            onContextMenu={(e) =>
              onMenu({ kind: "worktree", worktree }, { x: e.clientX, y: e.clientY })
            }
            trailing={
              <>
                <span className="side-note">{worktreeSubtitle(worktree)}</span>
                {/* A prunable worktree's directory is already gone, so
                    `worktree remove` has nothing to remove; pruning is the
                    operation that actually clears it. */}
                {worktree.prunable ? (
                  <LinkAction
                    label="prune"
                    title="Drop records for worktrees whose directories are gone"
                    hoverOnly
                    onClick={onPruneWorktrees}
                  />
                ) : (
                  !worktree.isMain && (
                    <LinkAction
                      label="remove"
                      title="Remove this worktree"
                      hoverOnly
                      onClick={() => onRemoveWorktree(worktree.path)}
                    />
                  )
                )}
              </>
            }
          />
        ))}
      </Section>

      <Section
        title="Submodules"
        defaultOpen
        count={submodules?.length}
        forceOpen={focused === "submodules"}
        number={panelNumber("submodules")}
        focused={focused === "submodules"}
        action={
          (submodules?.length ?? 0) > 0
            ? {
                label: "update all",
                title: "Run submodule update --init --recursive",
                onClick: onUpdateAllSubmodules,
              }
            : undefined
        }
      >
        {submodules?.length === 0 && <Empty>No submodules</Empty>}
        {submodules?.map((submodule) => (
          <Item
            key={submodule.path}
            {...rowProps(`submodule:${submodule.path}`)}
            label={submodule.path}
            title={`${submodule.url ?? submodule.path}\n${submoduleLabel[submodule.state]}`}
            leading={<span className={`sub-dot sub-${submodule.state}`} />}
            // An uninitialized submodule has no repository on disk yet, so
            // there is nothing to open until it has been updated.
            onDoubleClick={() =>
              submodule.state === "uninitialized"
                ? onUpdateSubmodule(submodule.path)
                : onOpenPath(submodule.path)
            }
            onContextMenu={(e) =>
              onMenu({ kind: "submodule", submodule }, { x: e.clientX, y: e.clientY })
            }
            trailing={
              submodule.state !== "upToDate" ? (
                <LinkAction
                  label={submodule.state === "uninitialized" ? "init" : "update"}
                  title="Run submodule update --init"
                  onClick={() => onUpdateSubmodule(submodule.path)}
                />
              ) : (
                <span className="side-note">
                  {submodule.describe ?? submodule.oid.slice(0, 7)}
                </span>
              )
            }
          />
        ))}
      </Section>

      {focused && (
        <p className="sidebar-hint">
          <Keys>
            <kbd>{shortcutLabel(keymap["sidebar.next"])}</kbd>
            <kbd>{shortcutLabel(keymap["sidebar.previous"])}</kbd> move
          </Keys>{" "}
          ·{" "}
          <Keys>
            <kbd>{shortcutLabel(keymap["sidebar.activate"])}</kbd> use
          </Keys>{" "}
          ·{" "}
          <Keys>
            <kbd>{shortcutLabel(keymap["sidebar.delete"])}</kbd> delete
          </Keys>{" "}
          ·{" "}
          <Keys>
            <kbd>{shortcutLabel(keymap["sidebar.leave"])}</kbd> back
          </Keys>
        </p>
      )}
    </nav>
  );
}

function worktreeSubtitle(worktree: Worktree) {
  if (worktree.isBare) return "bare";
  if (worktree.prunable) return "missing";
  if (worktree.isLocked) return "locked";
  if (worktree.isDetached) return worktree.head?.slice(0, 7) ?? "detached";
  return worktree.branch ?? "";
}

function leaf(path: string) {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/** Renders a grouped ref list: folders you can close, names you cannot.
 *
 *  Indentation comes from nesting the container rather than from a depth
 *  counter on each row, so a folder five deep needs no arithmetic and the rows
 *  themselves stay the same rows as in a flat section. */
function RefTree<T>({
  nodes,
  isFolded,
  onToggle,
  folderProps,
  renderLeaf,
}: {
  nodes: RefNode<T>[];
  isFolded: (path: string) => boolean;
  onToggle: (path: string) => void;
  /** Marks the folder row for the keyboard cursor. */
  folderProps: (path: string) => Record<string, unknown>;
  renderLeaf: (item: T, label: string) => ReactNode;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "leaf" ? (
          <Fragment key={node.path}>{renderLeaf(node.item, node.label)}</Fragment>
        ) : (
          <Fragment key={node.path}>
            <button
              {...folderProps(node.path)}
              title={node.path}
              onClick={() => onToggle(node.path)}
            >
              {/* The rail stays empty: it is the keyboard column, and a digit
                  there is always a key. The chevron gets a column of its own,
                  which every row in a grouped list reserves -- blank on a
                  branch, filled on a folder -- so a folder's name sits on the
                  same left edge as the branches beside it. */}
              <span className="side-rail" />
              <span className="side-twisty">
                <IconChevron open={!isFolded(node.path)} />
              </span>
              <span className="side-folder-label">{node.label}</span>
            </button>

            {!isFolded(node.path) && (
              <div className="side-nest">
                <RefTree
                  nodes={node.children}
                  isFolded={isFolded}
                  onToggle={onToggle}
                  folderProps={folderProps}
                  renderLeaf={renderLeaf}
                />
              </div>
            )}
          </Fragment>
        ),
      )}
    </>
  );
}

function Section({
  title,
  children,
  defaultOpen = false,
  nested = false,
  count,
  forceOpen = false,
  number,
  focused = false,
  action,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  nested?: boolean;
  count?: number;
  /** Expand regardless of the user's toggle, used while a filter is active or
   *  the panel has keyboard focus, so a match is never hidden. */
  forceOpen?: boolean;
  /** The digit that jumps here. Shown because it is the actual key. */
  number?: number;
  focused?: boolean;
  action?: { label: string; title: string; command?: string; onClick: () => void };
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const open = forceOpen || expanded;

  return (
    <div
      className={[
        "side-section",
        nested ? "side-section-nested" : "",
        focused ? "side-section-focused" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="side-header-row">
        {/* The rail. Every key in the sidebar sits in this column and nothing
            else does, so a digit here is always a key and a number on the
            right is always a count. */}
        <span className="side-rail">
          {number !== undefined && (
            <kbd className={`side-key ${focused ? "key-live" : ""}`}>{number}</kbd>
          )}
        </span>

        <button className="side-header" onClick={() => setExpanded(() => !open)}>
          <IconChevron open={open} />
          <span>{title}</span>
        </button>

        {action && (
          <LinkAction
            label={action.label}
            title={action.title}
            command={action.command}
            hoverOnly
            onClick={action.onClick}
          />
        )}

        {count !== undefined && count > 0 && <span className="side-count">{count}</span>}
      </div>

      {open && <div className="side-body">{children}</div>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="side-empty">{children}</div>;
}

function Item({
  label,
  active,
  bold,
  badge,
  nested,
  number,
  title,
  leading,
  trailing,
  className,
  onClick,
  onDoubleClick,
  onContextMenu,
  ...rest
}: {
  label: string;
  active?: boolean;
  bold?: boolean;
  badge?: number;
  nested?: boolean;
  number?: number;
  title?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
} & Record<string, unknown>) {
  return (
    <div
      {...rest}
      className={[
        className ?? "side-item",
        active ? "side-item-active" : "",
        bold ? "side-item-bold" : "",
        nested ? "side-item-nested" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={title ?? label}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={
        onContextMenu &&
        ((e: MouseEvent) => {
          // Suppress the WebView's own menu only where we offer a real one.
          e.preventDefault();
          onContextMenu(e);
        })
      }
    >
      <span className="side-rail">
        {number !== undefined && (
          <kbd className={`side-key ${active ? "key-live" : ""}`}>{number}</kbd>
        )}
      </span>

      {leading}
      <span className="side-item-label">{label}</span>
      {badge !== undefined && <span className="side-badge">{badge}</span>}
      {trailing}
    </div>
  );
}

function LinkAction({
  label,
  title,
  command,
  hoverOnly,
  onClick,
}: {
  label: string;
  title: string;
  /** The command this runs, so the tip can show its key. */
  command?: string;
  hoverOnly?: boolean;
  onClick: () => void;
}) {
  // The app's own tip, not the native one: these are controls, and a control
  // should say what key runs it. A `title` cannot draw a key cap.
  const tip = useTip();

  return (
    <button
      className={`link-button ${hoverOnly ? "hover-only" : ""}`}
      {...tip(title, command)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

function Tracking({ branch }: { branch: BranchRef }) {
  // No upstream at all is a different state from "in step with one", and the
  // two looked identical: both drew nothing. A branch that exists only on this
  // machine is worth saying out loud, since it is the one that gets lost.
  if (!branch.upstream) {
    return <span className="tracking-pill tracking-local">local</span>;
  }

  if (!branch.ahead && !branch.behind) return null;

  return (
    <span className="tracking-pill">
      {branch.ahead > 0 && <span className="ahead">&uarr;{branch.ahead}</span>}
      {branch.behind > 0 && <span className="behind">&darr;{branch.behind}</span>}
    </span>
  );
}
