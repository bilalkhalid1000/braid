import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";

import { IconChevron } from "./icons";
import { FilterInput, matchesFilter } from "./FilterInput";
import { useCommands } from "../lib/useCommands";
import { groupRefs, hasFolders, leafCount, visibleNodes, type RefNode } from "../lib/refTree";
import { useTip } from "./Tip";
import {
  submoduleLabel,
  type BranchRef,
  type ReflogEntry,
  type RemoteGroup,
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
  "reflog",
] as const;

export type PanelId = (typeof PANELS)[number];

export const SIDEBAR_PANELS: PanelId[] = [
  "branches",
  "remotes",
  "stashes",
  "worktrees",
  "submodules",
  "reflog",
];

export const isSidebarPanel = (panel: PanelId) => SIDEBAR_PANELS.includes(panel);

export const panelNumber = (panel: PanelId) => PANELS.indexOf(panel) + 1;

/** What was acted on. The sidebar reports it; App decides what it means. */
export type MenuTarget =
  | { kind: "branch"; branch: BranchRef }
  | { kind: "remote"; remote: string; branch: string }
  | { kind: "remoteGroup"; remote: RemoteGroup }
  | { kind: "reflog"; entry: ReflogEntry }
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
  reflog: ReflogEntry[] | undefined;
  view: WorkspaceView;
  focusedPanel: PanelId;
  /** False while a dialog or the palette holds the keyboard. */
  keyboardActive: boolean;
  onFocusPanel: (panel: PanelId) => void;
  onCheckout: (name: string) => void;
  /** A branch was clicked: show the commit it points at, where that means
   *  something. */
  onReveal: (oid: string) => void;
  onPublish: (name: string) => void;
  onStash: (selector: string, action: "apply" | "pop" | "drop") => void;
  onOpenPath: (path: string) => void;
  onNewBranch: () => void;
  onNewRemote: () => void;
  onNewTag: () => void;
  /** A stash was clicked: show what it holds. */
  onShowStash: (stash: StashEntry) => void;
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
  /** Edit whatever the cursor is on: a remote's name and URL, a branch's name. */
  onEdit: (target: MenuTarget | null) => void;
  onFetchRemote: (name: string) => void;
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

/* Pushed to the right of the row: it is a status on the branch, not part of
   its name. */
const TRACKING = "ml-auto flex flex-none gap-2 font-mono text-micro";

const FILTER =
  "sticky top-0 z-[1] px-4 py-3 bg-chrome border-b border-b-border-soft";

/* Every key in the sidebar sits in this column and nothing else does, so a
   digit here is always a key and a number on the right is always a count. */
const RAIL = "flex w-[21px] flex-none justify-center";

const SECTION_KEY = "h-[15px] min-w-[15px] px-[3px]";

const HEADER =
  "flex min-w-0 flex-1 items-center gap-3 pt-3 pr-2 pb-2 pl-0 bg-transparent border-0 " +
  "uppercase tracking-[0.09em] text-micro font-semibold text-text-dim text-left cursor-pointer " +
  "hover:text-text";

/* A nested section is a remote's name, not a heading: it reads as the thing it
   names rather than as a category. */
const NESTED_HEADER =
  "flex min-w-0 flex-1 items-center gap-3 pt-3 pr-2 pb-2 pl-6 bg-transparent border-0 " +
  "font-mono text-small text-text-dim text-left cursor-pointer";

const COUNT = "pl-3 font-mono text-micro font-normal tracking-normal text-text-faint";

const ITEM =
  "flex h-row items-center gap-3 pl-2 pr-4 border-l-2 text-text cursor-default";

const FOLDER =
  "flex h-row w-full items-center gap-3 pl-2 pr-4 bg-transparent border-0 border-l-2 " +
  "border-l-transparent [font-family:inherit] text-body text-text-dim text-left " +
  "cursor-default hover:bg-surface-alt hover:text-text";

const CURSOR = "bg-surface-alt shadow-[inset_0_0_0_1px_var(--color-accent)]";

const ITEM_LABEL =
  "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-small";
const ITEM_LABEL_SANS =
  "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body";

const BADGE =
  "ml-auto min-w-[18px] px-[5px] rounded-full bg-accent text-center font-mono " +
  "text-micro leading-[15px] text-white";

/* Capped: a worktree's state is an aside, and a long one must not push the
   path it belongs to out of the row. */
const NOTE =
  "ml-auto max-w-24 flex-none overflow-hidden pl-3 text-ellipsis whitespace-nowrap " +
  "font-mono text-micro text-text-faint";

export function Sidebar({
  refs,
  status,
  worktrees,
  submodules,
  reflog,
  view,
  focusedPanel,
  keyboardActive,
  onFocusPanel,
  onCheckout,
  onReveal,
  onPublish,
  onStash,
  onOpenPath,
  onNewBranch,
  onNewRemote,
  onNewTag,
  onShowStash,
  onAddWorktree,
  onRemoveWorktree,
  onPruneWorktrees,
  onUpdateSubmodule,
  onUpdateAllSubmodules,
  onMenu,
  onCursor,
  onDelete,
  onEdit,
  onFetchRemote,
}: Props) {
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
      // A remote with no branches is still a remote -- one just added, or
      // never fetched -- and is hidden only by a filter it does not match.
      .filter(
        (remote) =>
          remote.branches.length > 0 || (filter === "" || matchesFilter(remote.name, filter)),
      );

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
  const twisty = (_present: boolean) => (
    <span className="flex w-7 flex-none justify-center text-text-faint" />
  );

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
      // The remote itself is a stop, before its branches: it is the thing
      // you edit, fetch or remove, and a row is how a key reaches it.
      return shown.remotes.flatMap<Row>((remote) => [
        {
          key: `remote-group:${remote.name}`,
          activate: () => onFetchRemote(remote.name),
          menu: (at: Point) => onMenu({ kind: "remoteGroup", remote }, at),
          target: { kind: "remoteGroup", remote },
        },
        ...remote.branches.map<Row>((branch) => ({
          key: `remote:${remote.name}/${branch}`,
          activate: () => onCheckout(branch),
          menu: (at: Point) => onMenu({ kind: "remote", remote: remote.name, branch }, at),
          target: { kind: "remote", remote: remote.name, branch },
        })),
      ]);
    }

    if (focused === "stashes") {
      return shown.stashes.map((stash) => ({
        key: `stash:${stash.selector}`,
        activate: () => onStash(stash.selector, "pop"),
        menu: (at: Point) => onMenu({ kind: "stash", stash }, at),
      }));
    }

    if (focused === "reflog") {
      // Enter opens the menu rather than checking out: an entry is a place
      // to do something from, and none of the choices is the obvious one.
      return (reflog ?? []).map((entry) => ({
        key: `reflog:${entry.selector}`,
        activate: () => onMenu({ kind: "reflog", entry }, anchorOf(`reflog:${entry.selector}`)),
        menu: (at: Point) => onMenu({ kind: "reflog", entry }, at),
        target: { kind: "reflog", entry },
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
  }, [focused, shown, worktrees, submodules, reflog, branchTree, collapsed, open]);

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
  // Braced, so whatever the callback returns is not mistaken for a cleanup.
  useEffect(() => {
    onCursor?.(cursorTarget);
  }, [cursorTarget, onCursor]);

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
      "sidebar.edit": () => onEdit(rows[index]?.target ?? null),
      "sidebar.leave": () => onFocusPanel(view === "history" ? "history" : "files"),
    },
    // Escape belongs to whatever is on top: without this the sidebar would
    // also answer it from behind an open dialog.
    focused !== null && keyboardActive,
  );

  const rowProps = (key: string) => ({
    "data-row": key,
    className: selectedKey === key ? `${ITEM} ${CURSOR}` : ITEM,
  });

  /** The same, for a section heading that is also a row -- a remote. */
  const groupProps = (key: string) => ({
    "data-row": key,
    className: selectedKey === key ? CURSOR : "",
  });

  /** The same, for a folder row. It carries `data-row` for the same reason a
   *  branch does: the cursor scrolls itself into view by querying for it. */
  const folderProps = (key: string) => ({
    "data-row": key,
    className: selectedKey === key ? `${FOLDER} ${CURSOR}` : FOLDER,
  });

  return (
    <nav className="overflow-y-auto pb-6 bg-chrome">
      <div className={FILTER}>
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
          sans
          active={view === "status"}
          number={panelNumber("files")}
          badge={pending || undefined}
          onClick={() => onFocusPanel("files")}
        />
        <Item
          label="History"
          sans
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
            leading={branch.isHead ? <HeadMark /> : twisty(branchesGrouped)}
            label={label}
            active={branch.isHead}
            bold={branch.isHead}
            title={
              branch.isHead
                ? `${branch.name} (current)`
                : `${branch.name} – double-click or Enter to check out`
            }
            onClick={() => onReveal(branch.oid)}
            onDoubleClick={() => onCheckout(branch.name)}
            onContextMenu={(e) => onMenu({ kind: "branch", branch }, { x: e.clientX, y: e.clientY })}
            trailing={
              <>
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
                <Tracking branch={branch} />
              </>
            }
          />
          )}
        />
      </Section>

      <Section
        title="Tags"
        count={shown.tags.length}
        forceOpen={open}
        action={{
          title: "New tag",
          label: "New tag",
          command: "git.tag",
          onClick: onNewTag,
        }}
      >
        {shown.tags.length === 0 && <Empty>No tags</Empty>}
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
        action={{
          title: "Add a remote",
          label: "Add remote",
          command: "git.remote",
          onClick: onNewRemote,
        }}
      >
        {shown.remotes.length === 0 && <Empty>No remotes</Empty>}
        {shown.remotes.map((remote) => (
          <Section
            key={remote.name}
            title={remote.name}
            nested
            count={remote.branches.length}
            forceOpen={open || focused === "remotes"}
            headerProps={groupProps(`remote-group:${remote.name}`)}
            onContextMenu={(e) =>
              onMenu({ kind: "remoteGroup", remote }, { x: e.clientX, y: e.clientY })
            }
          >
            {remote.branches.length === 0 && <Empty>Nothing fetched yet</Empty>}
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
        {shown.stashes.length === 0 && <Empty>No stashes</Empty>}
        {shown.stashes.map((stash) => (
          <Item
            key={stash.selector}
            {...rowProps(`stash:${stash.selector}`)}
            label={stash.message}
            title={`${stash.selector} – click to see what it holds, Enter to pop`}
            onClick={() => onShowStash(stash)}
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
                <span className={NOTE}>{worktreeSubtitle(worktree)}</span>
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
                <span className={NOTE}>
                  {submodule.describe ?? submodule.oid.slice(0, 7)}
                </span>
              )
            }
          />
        ))}
      </Section>

      <Section
        title="Reflog"
        count={reflog?.length}
        forceOpen={focused === "reflog"}
        number={panelNumber("reflog")}
        focused={focused === "reflog"}
      >
        {(reflog ?? []).length === 0 && <Empty>HEAD has not moved yet</Empty>}
        {(reflog ?? []).map((entry) => (
          <Item
            key={entry.selector}
            {...rowProps(`reflog:${entry.selector}`)}
            label={entry.subject}
            sans
            title={`${entry.short} – ${entry.selector}, ${entry.when}`}
            onContextMenu={(e) =>
              onMenu({ kind: "reflog", entry }, { x: e.clientX, y: e.clientY })
            }
            trailing={<span className={NOTE}>{entry.when}</span>}
          />
        ))}
      </Section>
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
  const tip = useTip();

  return (
    <>
      {nodes.map((node) =>
        node.kind === "leaf" ? (
          <Fragment key={node.path}>{renderLeaf(node.item, node.label)}</Fragment>
        ) : (
          <Fragment key={node.path}>
            <button
              {...folderProps(node.path)}
              {...(node.path !== node.label ? tip(node.path) : {})}
              onClick={() => onToggle(node.path)}
            >
              {/* The rail stays empty: it is the keyboard column, and a digit
                  there is always a key. The chevron gets a column of its own,
                  which every row in a grouped list reserves -- blank on a
                  branch, filled on a folder -- so a folder's name sits on the
                  same left edge as the branches beside it. */}
              <span className={RAIL} />
              <span className="flex w-7 flex-none justify-center text-text-faint">
                <IconChevron open={!isFolded(node.path)} />
              </span>
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {node.label}
              </span>
              <span className={COUNT}>{leafCount(node)}</span>
            </button>

            {!isFolded(node.path) && (
              <div className="pl-7">
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
  onContextMenu,
  headerProps,
}: {
  title: string;
  children: ReactNode;
  /** Right-click on the heading, for a section that is itself a thing. */
  onContextMenu?: (event: MouseEvent) => void;
  /** For a heading the keyboard cursor can land on: its row key and the
   *  cursor's look when it is there. */
  headerProps?: { "data-row": string; className: string };
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
    // Space above a top-level section, and none above a nested one: a remote
    // belongs to the Remotes heading above it, and a gap there would read as
    // a section of its own.
    <div data-focused={focused || undefined} className={nested ? "" : "mt-3"}>
      <div
        data-row={headerProps?.["data-row"]}
        className={`group flex items-center pr-4 ${headerProps?.className ?? ""}`}
        onContextMenu={
          onContextMenu &&
          ((e: MouseEvent) => {
            e.preventDefault();
            onContextMenu(e);
          })
        }
      >
        {/* The rail. Every key in the sidebar sits in this column and nothing
            else does, so a digit here is always a key and a number on the
            right is always a count. */}
        <span className={RAIL}>
          {number !== undefined && (
            <kbd
              className={`${SECTION_KEY} ${
                focused ? "key-live bg-accent border-accent text-white" : ""
              }`}
            >
              {number}
            </kbd>
          )}
        </span>

        <button className={nested ? NESTED_HEADER : HEADER} onClick={() => setExpanded(() => !open)}>
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

        {count !== undefined && count > 0 && <span className={COUNT}>{count}</span>}
      </div>

      {open && <div>{children}</div>}
    </div>
  );
}

/** What a section says when it has nothing to list.
 *
 *  Laid out as a row -- rail, then text -- so it sits on the same left edge as
 *  the rows it stands in for, rather than floating at its own indent. */
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-row items-center gap-3 pl-2 pr-4">
      <span className={RAIL} />
      <span className="text-small text-text-faint">{children}</span>
    </div>
  );
}

/** HEAD, drawn the way the history graph draws it: a ring on the lane. Sits in
 *  the structure column beside the branch, where a folder shows its chevron --
 *  a statement about where the checkout is in the tree, in the app's own mark.
 *  Static, so reduced motion has nothing to switch off. */
function HeadMark() {
  return (
    <span className="flex w-7 flex-none justify-center" aria-label="checked out">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <circle
          cx="7"
          cy="7"
          r="3.5"
          fill="var(--color-surface)"
          stroke="var(--color-accent)"
          strokeWidth="1.75"
        />
      </svg>
    </span>
  );
}

function Item({
  label,
  sans,
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
  /** Set in the chrome face. For a name the app chose rather than a string
   *  git would print -- the typographic rule is that refs and paths are mono
   *  and everything you click is sans. */
  sans?: boolean;
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
  const tip = useTip();

  // Some rows describe themselves over more than one line -- a worktree's path
  // and its state, a submodule's url and whether it is initialized. The first
  // line is the thing; the rest is about it, which is what the tip's note is
  // for and what a native title could never lay out.
  const [head, ...rest_lines] = (title ?? label).split("\n");
  const note = rest_lines.join("\n");

  return (
    <div
      {...rest}
      {...tip(head ?? label, undefined, note || undefined)}
      className={[
        className ?? ITEM,
        active ? "bg-select border-l-accent" : "border-l-transparent hover:bg-surface-alt",
        bold ? "font-semibold" : "",
        nested ? "pl-8" : "",
      ]
        .filter(Boolean)
        .join(" ")}
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
      <span className={RAIL}>
        {number !== undefined && (
          <kbd className={`side-key ${active ? "key-live" : ""}`}>{number}</kbd>
        )}
      </span>

      {leading}
      <span className={sans ? ITEM_LABEL_SANS : ITEM_LABEL}>{label}</span>
      {badge !== undefined && <span className={BADGE}>{badge}</span>}
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
    return <span className={`${TRACKING} font-sans tracking-[0.02em] text-text-faint`}>local</span>;
  }

  if (!branch.ahead && !branch.behind) return null;

  return (
    <span className={TRACKING}>
      {branch.ahead > 0 && <span className="text-added">&uarr;{branch.ahead}</span>}
      {branch.behind > 0 && <span className="text-removed">&darr;{branch.behind}</span>}
    </span>
  );
}
