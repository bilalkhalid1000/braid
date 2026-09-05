import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { api, type SearchKind } from "../lib/api";
import { useCommands } from "../lib/useCommands";
import { MIN_QUERY, SETTLE_MS, searchable } from "../lib/search";

const ROW_HEIGHT = 22;

const KINDS: { id: SearchKind; label: string; hint: string }[] = [
  { id: "commits", label: "Commits", hint: "message or author" },
  { id: "code", label: "Code", hint: "lines in the working tree" },
  { id: "files", label: "Files", hint: "tracked paths" },
];

/** One result, flattened so the three kinds can share a list. */
interface Row {
  key: string;
  primary: string;
  secondary: string;
  /** Where selecting it goes. */
  go: () => void;
}

interface Props {
  repoId: string;
  keyboardActive: boolean;
  onClose: () => void;
  /** Show a commit in the history view. */
  onCommit: (oid: string) => void;
  /** Show a file, at a line where one is known. */
  onFile: (path: string) => void;
}

/** Searching a repository: commits, code, or file paths.
 *
 *  Three questions that all begin as one typed word, so they share a box and
 *  differ only in what is asked. Nothing here matches anything itself — git
 *  already does that faster than a walk from the outside could, and it agrees
 *  with the git the user runs in a terminal.
 */
const BOX =
  "min-w-0 flex-1 px-4 py-3 bg-surface border border-border rounded-sm " +
  "font-mono text-body text-text focus:border-accent focus:outline-none";

const KIND = "px-6 py-3 bg-transparent border-0 cursor-pointer";

const STATUS =
  "flex flex-none items-center gap-3 px-6 py-3 border-b border-b-border-soft " +
  "text-micro text-text-faint";

/* Absolutely placed: the rows are virtualized, so each one is positioned by
   the measurement rather than by flow. */
const ROW = "absolute top-0 left-0 flex w-full items-center gap-6 px-6 cursor-default";

const PRIMARY =
  "select-text min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-body text-text";

/* Capped, so a long path cannot push the line it belongs to out of view. */
const SECONDARY =
  "select-text max-w-[45%] flex-none overflow-hidden text-ellipsis whitespace-nowrap font-mono " +
  "text-micro text-text-faint";

export function SearchView({ repoId, keyboardActive, onClose, onCommit, onFile }: Props) {
  const [kind, setKind] = useState<SearchKind>("commits");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Debounced: the box holds what was typed, the query holds what git was
  // actually asked, and they converge once typing stops. Every keystroke
  // clears the pending timer, so a word typed at speed costs one search.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(typed), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const results = useQuery({
    queryKey: ["search", repoId, kind, query],
    queryFn: () => api.search(repoId, query, kind),
    enabled: searchable(query),
    staleTime: 30_000,
  });

  const rows = useMemo<Row[]>(() => {
    const found = results.data;
    if (!found) return [];

    if (kind === "commits") {
      return found.commits.map((commit) => ({
        key: commit.oid,
        primary: commit.subject,
        secondary: `${commit.short}  ${commit.author}`,
        go: () => onCommit(commit.oid),
      }));
    }

    if (kind === "code") {
      return found.code.map((hit, index) => ({
        key: `${hit.path}:${hit.line}:${index}`,
        primary: hit.text.trim(),
        secondary: `${hit.path}:${hit.line}`,
        go: () => onFile(hit.path),
      }));
    }

    return found.files.map((path) => ({
      key: path,
      primary: path,
      secondary: "",
      go: () => onFile(path),
    }));
  }, [results.data, kind, onCommit, onFile]);

  useEffect(() => setCursor(0), [kind, query]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  useEffect(() => {
    if (rows.length > 0) virtualizer.scrollToIndex(cursor, { align: "auto" });
  }, [cursor, rows.length, virtualizer]);

  const move = (delta: number) =>
    setCursor((at) => Math.min(Math.max(at + delta, 0), Math.max(rows.length - 1, 0)));

  useCommands(
    {
      "search.next": () => move(1),
      "search.previous": () => move(-1),
      "search.open": () => rows[cursor]?.go(),
      "search.close": onClose,
    },
    keyboardActive,
  );

  const searching = searchable(typed) && (results.isFetching || typed !== query);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex flex-none items-center gap-6 bg-chrome p-4 border-b border-b-border">
        <input
          className={BOX}
          data-filter="search"
          value={typed}
          autoFocus
          spellCheck={false}
          placeholder={`Search ${KINDS.find((k) => k.id === kind)?.hint}`}
          onChange={(e) => setTyped(e.target.value)}
          // Enter goes to the top result without leaving the box, which is
          // what typing then pressing Enter is asking for.
          onKeyDown={(e) => {
            if (e.key === "Enter") rows[cursor]?.go();
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            }
          }}
        />

        <div className="flex flex-none overflow-hidden rounded-sm border border-border">
          {KINDS.map((option) => (
            <button
              key={option.id}
              className={`${KIND} ${
                kind === option.id
                  ? "bg-accent text-white"
                  : "text-text-dim hover:bg-surface-alt hover:text-text"
              }`}
              onClick={() => setKind(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button className="btn" onClick={onClose}>
          Close
        </button>
      </header>

      <div className={STATUS}>
        {!searchable(typed) ? (
          <span>
            {typed.trim() === ""
              ? "Type to search. Nothing runs until you stop typing."
              : `Keep going — at least ${MIN_QUERY} characters.`}
          </span>
        ) : searching ? (
          <span>
            <span className="spinner" /> Searching…
          </span>
        ) : (
          <span>
            {rows.length === 0
              ? "No matches."
              : `${rows.length}${results.data?.truncated ? "+" : ""} ${
                  rows.length === 1 ? "match" : "matches"
                }`}
            {results.data && ` · ${results.data.durationMs}ms`}
            {results.data?.truncated && " · narrow it to see the rest"}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
        <div className="virtual-canvas" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;

            return (
              <div
                key={row.key}
                className={`${ROW} ${
                  item.index === cursor ? "bg-select shadow-[inset_0_0_0_1px_var(--color-accent)]" : ""
                }`}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                onMouseEnter={() => setCursor(item.index)}
                onMouseDown={() => row.go()}
              >
                <span className={PRIMARY}>{row.primary}</span>
                {row.secondary && <span className={SECONDARY}>{row.secondary}</span>}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
