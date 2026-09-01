import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { api, type SearchKind } from "../lib/api";
import { useCommands } from "../lib/useCommands";
import { useSettings } from "../lib/settings";
import { shortcutLabel } from "../lib/shortcutLabel";
import { Keys } from "./Keys";
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
export function SearchView({ repoId, keyboardActive, onClose, onCommit, onFile }: Props) {
  const [kind, setKind] = useState<SearchKind>("commits");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { keymap } = useSettings();

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
    <div className="search">
      <header className="search-head">
        <input
          className="search-box"
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

        <div className="search-kinds">
          {KINDS.map((option) => (
            <button
              key={option.id}
              className={`search-kind ${kind === option.id ? "search-kind-active" : ""}`}
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

      <div className="search-status">
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

      <div className="search-body" ref={scrollRef}>
        <div className="virtual-canvas" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;

            return (
              <div
                key={row.key}
                className={`search-row ${item.index === cursor ? "search-row-cursor" : ""}`}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                onMouseEnter={() => setCursor(item.index)}
                onMouseDown={() => row.go()}
              >
                <span className="search-primary">{row.primary}</span>
                {row.secondary && <span className="search-secondary">{row.secondary}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {keyboardActive && (
        <p className="pane-hint">
          <Keys>
            <kbd>{shortcutLabel(keymap["search.next"])}</kbd>
            <kbd>{shortcutLabel(keymap["search.previous"])}</kbd> move
          </Keys>{" "}
          ·{" "}
          <Keys>
            <kbd>{shortcutLabel(keymap["search.open"])}</kbd> go to it
          </Keys>{" "}
          ·{" "}
          <Keys>
            <kbd>{shortcutLabel(keymap["search.close"])}</kbd> close
          </Keys>
        </p>
      )}
    </div>
  );
}
