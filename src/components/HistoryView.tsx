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
import { useSettings } from "../lib/settings";

const ROW_HEIGHT = 26;

/** Enough for a trunk and a couple of branches; the rest is a drag away. */
const DEFAULT_GRAPH_WIDTH = 130;

interface Props {
  repoId: string;
  headOid: string | null;
  /** False while a sidebar panel holds the keyboard. */
  keyboardActive: boolean;
  /** A commit to select when it arrives — set by a search result. */
  focusOid?: string | null;
}

/** Commit history.
 *
 *  Read one page at a time and rendered through a virtualizer, so opening a
 *  repository with 200k commits costs the same as one with 20. */
export function HistoryView({ repoId, headOid, keyboardActive, focusOid }: Props) {
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

  // A commit asked for from elsewhere, selected once the page holding it has
  // loaded. History reads newest first, so an old commit may be several pages
  // down; this waits rather than guessing, and does nothing if it never
  // arrives.
  useEffect(() => {
    if (!focusOid) return;

    const at = commits.findIndex((commit) => commit.oid === focusOid);
    if (at === -1) return;

    setSelected(commits[at]!);
    virtualizer.scrollToIndex(at, { align: "center" });
  }, [focusOid, commits, virtualizer]);

  // Picking a different commit puts the keyboard back on the commit list: the
  // file list under it has just been replaced by another commit's.
  useEffect(() => setPane("commits"), [selected?.oid]);

  const toCommits = () => setPane("commits");

  const { copied, copy } = useCopy();

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
    <div className="history" style={{ gridTemplateRows: `${tableHeight}px 4px minmax(0, 1fr)` }}>
      <div className="history-table">
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

        <header className="history-head">
          <span className="history-graph-head" style={{ width: laneColumns * LANE_WIDTH }}>
            {graph.maxLanes > laneColumns && (
              <span className="history-lane-more" title={`${graph.maxLanes} lanes — drag to show more`}>
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

        <div className="history-body" ref={scrollRef}>
          <div className="virtual-canvas" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => {
              const commit = commits[item.index];
              const row = graph.rows[item.index];
              if (!commit || !row) return null;

              return (
                <div
                  key={item.key}
                  className={[
                    "history-row",
                    commit.oid === selected?.oid && "history-row-selected",
                    commit.oid === selected?.oid &&
                      pane === "commits" &&
                      "history-row-cursor",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                  onMouseDown={() => {
                    toCommits();
                    setSelected(commit);
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

                  <span className="col-subject">
                    {commit.refs.map((ref) => (
                      <span key={ref} className={`ref-chip ${chipClass(ref)}`}>
                        {ref.replace("HEAD -> ", "")}
                      </span>
                    ))}
                    {commit.subject}
                  </span>

                  <span className="col-date">{formatDate(commit.timestamp)}</span>
                  <span className="col-author" title={commit.email}>
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

      <div className="history-detail">
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
