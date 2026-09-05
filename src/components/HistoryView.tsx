import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { api, type Commit, type HistoryScope } from "../lib/api";
import { buildGraph } from "../lib/graph";
import { CommitGraph, LANE_WIDTH } from "./CommitGraph";
import { Splitter, usePaneSize } from "./Splitter";
import { CommitDetail, type CommitDetailHandle } from "./CommitDetail";
import { useCommands } from "../lib/useCommands";
import { useCopy } from "../lib/useCopy";
import { CopyHash } from "./CopyHash";
import { useTip } from "./Tip";
import { useSettings } from "../lib/settings";

const ROW_HEIGHT = 26;

/* Three tracks, in order: the scope bar, the column headings, then the rows.
   Only the last absorbs what is left. */
const TABLE = "grid grid-rows-[auto_auto_minmax(0,1fr)] min-h-0 outline-none";

const COLUMNS =
  "grid grid-cols-[auto_4px_minmax(0,1fr)_92px_148px_74px] items-center gap-4 pr-6";

const HEAD =
  COLUMNS + " h-12 pl-6 bg-surface-alt border-b border-b-border-soft " +
  "text-small font-semibold text-text-dim";

/* `group` so the graph's casing can follow the row it is drawn on. Absolutely
   placed, because the list is virtualized. */
const ROW =
  "group " + COLUMNS + " absolute top-0 left-0 w-full pl-6 border-l-2 cursor-default";

const DETAIL =
  "relative grid grid-rows-[minmax(0,1fr)] min-h-0 overflow-hidden bg-surface";

/** Enough for a trunk and a couple of branches; the rest is a drag away. */
const DEFAULT_GRAPH_WIDTH = 130;

/** How far down the walk goes looking for HEAD before giving up. */
const REVEAL_PAGES = 10;

interface Props {
  repoId: string;
  headOid: string | null;
  /** False while a sidebar panel holds the keyboard. */
  keyboardActive: boolean;
  /** A commit to select when it arrives — set by a search result or a click
   *  on a branch. */
  focusOid?: string | null;
  /** The commit was selected. The owner clears its request here, so the same
   *  one can be asked for again and a later page load does not re-select it. */
  onFocused?: () => void;
  /** Right-click on a commit. The menu itself belongs to the app, which is
   *  what knows how to run the things on it. */
  onCommitMenu: (commit: Commit, at: { x: number; y: number }) => void;
}

/** Commit history.
 *
 *  Read one page at a time and rendered through a virtualizer, so opening a
 *  repository with 200k commits costs the same as one with 20. */
export function HistoryView({
  repoId,
  headOid,
  keyboardActive,
  focusOid,
  onFocused,
  onCommitMenu,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Commit | null>(null);
  const detailRef = useRef<CommitDetailHandle>(null);
  /** Which half of this view the keyboard is driving: the commits, or the files
   *  of the one selected. Two lists on screen, one cursor between them. */
  const [pane, setPane] = useState<"commits" | "files">("commits");
  const [tableHeight, setTableHeight] = usePaneSize("history-table", 420);
  const [graphWidth, setGraphWidth] = usePaneSize("history-graph", DEFAULT_GRAPH_WIDTH);
  const { settings, update } = useSettings();
  const pageSize = settings.historyPageSize;
  const scope = settings.historyScope;

  const log = useInfiniteQuery({
    // The scope is part of the key: changing it is a different walk, not a
    // filter over the one already loaded.
    queryKey: ["log", repoId, pageSize, scope],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.repoLog(repoId, pageParam, pageSize, scope),
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.length * pageSize : undefined,
    staleTime: Infinity,
  });

  const commits = useMemo(
    () => log.data?.pages.flatMap((page) => page.commits) ?? [],
    [log.data],
  );

  // Lane assignment depends on every commit before it, so the whole loaded
  // prefix is laid out at once and reused until another page arrives.
  const graph = useMemo(() => buildGraph(commits), [commits]);

  // How many lanes the column has room for. Lanes past this are clamped onto
  // the last one, which is why the column is draggable: widening it is how you
  // see what was folded into that edge.
  const laneColumns = Math.max(1, Math.floor(graphWidth / LANE_WIDTH));

  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const items = virtualizer.getVirtualItems();

  // Fetch the next page as the viewport approaches the end of what is loaded,
  // rather than on a scrollbar-bottom event, so scrolling never stalls.
  useEffect(() => {
    const last = items[items.length - 1];
    if (!last) return;

    if (last.index >= commits.length - 50 && log.hasNextPage && !log.isFetchingNextPage) {
      void log.fetchNextPage();
    }
  }, [items, commits.length, log]);

  const move = (delta: number) => {
    const index = selected ? commits.findIndex((c) => c.oid === selected.oid) : -1;
    const next = commits[Math.min(Math.max(index + delta, 0), commits.length - 1)];
    if (next) {
      setSelected(next);
      virtualizer.scrollToIndex(commits.indexOf(next), { align: "auto" });
    }
  };

  // Reads the next page when a commit asked for is not loaded yet. History
  // reads newest first, so an old commit may be several pages down.
  // ponytail: walks up to REVEAL_PAGES pages, then gives up rather than
  // pulling a whole 200k-commit history for a detached HEAD.
  const walkFurther = () => {
    const pages = log.data?.pages.length ?? 0;
    if (pages < REVEAL_PAGES && log.hasNextPage && !log.isFetchingNextPage) {
      void log.fetchNextPage();
    }
  };

  // A commit asked for from elsewhere, selected once the page holding it has
  // loaded.
  useEffect(() => {
    if (!focusOid) return;

    const at = commits.findIndex((commit) => commit.oid === focusOid);
    if (at === -1) {
      walkFurther();
      return;
    }

    toCommits();
    setSelected(commits[at]!);
    virtualizer.scrollToIndex(at, { align: "center" });
    onFocused?.();
  }, [focusOid, commits, log, virtualizer]);

  // HEAD scrolled into view whenever it moves, so a checkout to a branch far
  // down the list shows where you landed. Selection is left alone: checking
  // out is not choosing a commit to read. Remembered by hash rather than done
  // once, so a later page load does not drag the view back.
  const shownHead = useRef<string | null>(null);
  useEffect(() => {
    if (!headOid || shownHead.current === headOid) return;

    const at = commits.findIndex((commit) => commit.oid === headOid);
    if (at === -1) {
      walkFurther();
      return;
    }

    shownHead.current = headOid;
    virtualizer.scrollToIndex(at, { align: "auto" });
  }, [headOid, commits, log, virtualizer]);

  // Picking a different commit puts the keyboard back on the commit list: the
  // file list under it has just been replaced by another commit's.
  useEffect(() => setPane("commits"), [selected?.oid]);

  const toCommits = () => setPane("commits");

  const { copied, copy } = useCopy();
  const tip = useTip();

  useCommands({
    "history.next": () => (pane === "files" ? detailRef.current?.move(1) : move(1)),
    "history.previous": () =>
      pane === "files" ? detailRef.current?.move(-1) : move(-1),
    "history.top": () => {
      const first = commits[0];
      if (first) {
        toCommits();
        setSelected(first);
        virtualizer.scrollToIndex(0, { align: "start" });
      }
    },
    // Enter descends into the commit's files; an empty commit has nothing to
    // descend into, so it stays put rather than moving the cursor nowhere.
    "history.files": () => {
      if (pane === "files" || !selected) return;
      if ((detailRef.current?.count() ?? 0) === 0) return;

      setPane("files");
      detailRef.current?.move(1);
    },
    // The full hash, not the abbreviation on screen: a short hash is for
    // reading, and pasting one into a command is how you learn it was
    // ambiguous.
    "history.copyHash": () => {
      if (selected) void copy(selected.oid, selected.oid, selected.short);
    },
    "history.back": toCommits,
  }, keyboardActive);

  return (
    <div className="grid min-h-0 flex-1 basis-auto" style={{ gridTemplateRows: `${tableHeight}px 4px minmax(0, 1fr)` }}>
      <div className={TABLE}>
        {/* What is being walked, said out loud. Without it a branch missing
            from the graph looks like a bug in the graph rather than a choice
            about which refs it starts from. */}
        <div className="flex flex-none items-center gap-3 border-b border-b-border-soft bg-surface-alt px-3 py-2">
          <select
            className="rounded-sm border border-border bg-surface px-3 py-[1px] text-small"
            value={scope}
            aria-label="Which branches to show"
            onChange={(e) => update({ historyScope: e.target.value as HistoryScope })}
          >
            <option value="all">All branches and tags</option>
            <option value="local">Local branches and tags</option>
            <option value="head">Current branch</option>
          </select>

          <span className="text-micro text-text-faint">
            {commits.length}
            {log.hasNextPage ? "+" : ""} commits
          </span>
        </div>

        <header className={HEAD}>
          <span className="flex items-center justify-end overflow-hidden" style={{ width: laneColumns * LANE_WIDTH }}>
            {graph.maxLanes > laneColumns && (
              <span
                className="font-mono text-micro text-text-faint"
                {...tip(`${graph.maxLanes} lanes`, undefined, "Drag the divider to show more")}
              >
                +{graph.maxLanes - laneColumns}
              </span>
            )}
          </span>

          {/* Sits in the header but sizes the whole column: every row's graph
              is drawn to the same width, so dragging here moves them all. */}
          <Splitter
            axis="x"
            value={graphWidth}
            onChange={setGraphWidth}
            min={LANE_WIDTH}
            max={520}
            className="self-stretch"
            wide
          />

          <span>Description</span>
          <span>Date</span>
          <span>Author</span>
          <span>Commit</span>
        </header>

        <div className="relative overflow-y-auto bg-surface" ref={scrollRef}>
          <div className="virtual-canvas" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => {
              const commit = commits[item.index];
              const row = graph.rows[item.index];
              if (!commit || !row) return null;

              return (
                <div
                  key={item.key}
                  // The graph's casing follows the fill, so HEAD counts too.
                  data-selected={commit.oid === selected?.oid || commit.oid === headOid}
                  className={[
                    ROW,
                    // The checked-out commit wears the same fill and edge as
                    // the checked-out branch in the sidebar: that fill means
                    // "current" there, and now here. The cursor is the inset
                    // outline, in both places, so the two never collide.
                    commit.oid === selected?.oid || commit.oid === headOid
                      ? "bg-select border-l-accent"
                      : "border-l-transparent hover:bg-surface-alt",
                    commit.oid === selected?.oid &&
                      pane === "commits" &&
                      "shadow-[inset_0_0_0_1px_var(--color-accent)]",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                  onMouseDown={() => {
                    toCommits();
                    setSelected(commit);
                  }}
                  // Select first, so the menu always acts on the row it was
                  // raised over rather than on whatever was selected before.
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toCommits();
                    setSelected(commit);
                    onCommitMenu(commit, { x: e.clientX, y: e.clientY });
                  }}
                >
                  <CommitGraph
                    row={row}
                    lanes={laneColumns}
                    height={ROW_HEIGHT}
                    isHead={commit.oid === headOid}
                  />

                  {/* The column the splitter occupies in the header. Rows have
                      to reserve it too, or every heading sits four pixels off
                      the values under it. */}
                  <span />

                  {/* The checked-out commit is set in bold as well as ringed
                      in the graph: the ring can sit in a folded lane. */}
                  <span
                    className={
                      "overflow-hidden text-ellipsis whitespace-nowrap" +
                      (commit.oid === headOid ? " font-semibold" : "")
                    }
                  >
                    {commit.refs.map((ref) => (
                      <span
                        key={ref}
                        className={`ref-chip ${chipClass(ref)}`}
                        {...(ref.startsWith("HEAD ->") ? tip("Current branch") : {})}
                      >
                        {ref.replace("HEAD -> ", "")}
                      </span>
                    ))}
                    {commit.subject}
                  </span>

                  <span className="text-small text-text-dim">{formatDate(commit.timestamp)}</span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-small text-text-dim" {...tip(commit.author, undefined, commit.email)}>
                    {commit.author}
                  </span>
                  <CopyHash
                    short={commit.short}
                    copied={copied === commit.oid}
                    onCopy={() => void copy(commit.oid, commit.oid, commit.short)}
                  />
                </div>
              );
            })}
          </div>

          {commits.length === 0 && (
            <div className="pane-empty">
              {log.isFetching ? "Reading history…" : "No commits yet"}
            </div>
          )}
        </div>
      </div>

      <Splitter
        axis="y"
        value={tableHeight}
        onChange={setTableHeight}
        min={120}
        max={900}
      />

      <div className={DETAIL}>
        {selected ? (
          <CommitDetail
            ref={detailRef}
            repoId={repoId}
            oid={selected.oid}
            focused={pane === "files"}
          />
        ) : (
          <div className="pane-empty">Select a commit to see what it changed</div>
        )}
      </div>
    </div>
  );
}

function chipClass(ref: string) {
  if (ref.startsWith("HEAD ->")) return "ref-head";
  if (ref.startsWith("tag:")) return "ref-tag";
  if (ref.includes("/")) return "ref-remote";
  return "ref-local";
}

function formatDate(seconds: number, withTime = false) {
  const date = new Date(seconds * 1000);
  return withTime ? date.toLocaleString() : date.toLocaleDateString();
}
