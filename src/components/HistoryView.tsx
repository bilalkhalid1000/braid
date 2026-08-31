import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { api, type Commit } from "../lib/api";
import { buildGraph } from "../lib/graph";
import { CommitGraph, LANE_WIDTH } from "./CommitGraph";
import { Splitter, usePaneSize } from "./Splitter";
import { CommitDetail } from "./CommitDetail";
import { useCommands } from "../lib/useCommands";
import { useSettings } from "../lib/settings";

const ROW_HEIGHT = 26;
const MAX_GRAPH_LANES = 10;

interface Props {
  repoId: string;
  headOid: string | null;
  /** False while a sidebar panel holds the keyboard. */
  keyboardActive: boolean;
}

/** Commit history.
 *
 *  Read one page at a time and rendered through a virtualizer, so opening a
 *  repository with 200k commits costs the same as one with 20. */
export function HistoryView({ repoId, headOid, keyboardActive }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Commit | null>(null);
  const [tableHeight, setTableHeight] = usePaneSize("history-table", 420);
  const { settings } = useSettings();
  const pageSize = settings.historyPageSize;

  const log = useInfiniteQuery({
    queryKey: ["log", repoId, pageSize],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.repoLog(repoId, pageParam, pageSize),
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
  const laneColumns = Math.min(graph.maxLanes, MAX_GRAPH_LANES);

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

  useCommands({
    "history.next": () => move(1),
    "history.previous": () => move(-1),
    "history.top": () => {
      const first = commits[0];
      if (first) {
        setSelected(first);
        virtualizer.scrollToIndex(0, { align: "start" });
      }
    },
  }, keyboardActive);

  return (
    <div className="history" style={{ gridTemplateRows: `${tableHeight}px 4px minmax(0, 1fr)` }}>
      <div className="history-table">
        <header className="history-head">
          <span style={{ width: laneColumns * LANE_WIDTH }} />
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
                  className={`history-row ${commit.oid === selected?.oid ? "history-row-selected" : ""}`}
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                  onMouseDown={() => setSelected(commit)}
                >
                  <CommitGraph
                    row={row}
                    lanes={laneColumns}
                    height={ROW_HEIGHT}
                    isHead={commit.oid === headOid}
                  />

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
                  <span className="col-oid">{commit.short}</span>
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
          <CommitDetail repoId={repoId} oid={selected.oid} />
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
