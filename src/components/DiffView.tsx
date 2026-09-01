import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { DiffLine, FileDiff } from "../lib/api";
import { useSettings } from "../lib/settings";
import { highlightHunks, languageOf } from "../lib/highlight";
import { Code } from "./Code";
import { useTip } from "./Tip";

const LINE_HEIGHT = 18;

type DiffRow =
  | { kind: "hunk"; hunk: number; header: string }
  | { kind: "line"; hunk: number; index: number; line: DiffLine };

/** What a hunk button does, phrased from the side of the index it moves. */
export type HunkAction = "stage" | "unstage" | "discard";

export interface HunkRequest {
  hunk: number;
  /** Indices within the hunk, or undefined for all of it. */
  lines?: number[];
  action: HunkAction;
}

interface Props {
  diff: FileDiff | undefined;
  loading: boolean;
  emptyMessage: string;
  /** Omitted where a diff is only for reading, as in a past commit. */
  onHunk?: (request: HunkRequest) => void;
  /** Which side of the index this diff is, deciding what the buttons offer. */
  staged?: boolean;
}

/** Unified diff, virtualized.
 *
 *  A generated file can produce hundreds of thousands of diff lines. Rendering
 *  only the visible ones is what keeps selecting such a file from freezing the
 *  window. */
export function DiffView({ diff, loading, emptyMessage, onHunk, staged }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const tip = useTip();

  /** Selected lines, keyed "hunk:index". Cleared whenever the file changes. */
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => setPicked(new Set()), [diff?.path, staged]);

  const rows = useMemo<DiffRow[]>(() => {
    if (!diff) return [];

    return diff.hunks.flatMap<DiffRow>((hunk, h) => [
      { kind: "hunk", hunk: h, header: hunk.header },
      ...hunk.lines.map<DiffRow>((line, index) => ({ kind: "line", hunk: h, index, line })),
    ]);
  }, [diff]);

  // Keyed on the diff alone, deliberately. This component re-renders on every
  // click while lines are being picked for partial staging, and a dependency
  // that moved with `picked` would re-tokenize the file on each one.
  const highlighted = useMemo(
    () => (diff ? highlightHunks(diff.hunks, languageOf(diff.path)) : null),
    [diff],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 30,
  });

  // A patch built from a whitespace-ignoring diff does not describe the file
  // and will not apply, so the actions are withdrawn rather than left to fail.
  const canApply = Boolean(onHunk) && !settings.ignoreWhitespace;

  const key = (hunk: number, index: number) => `${hunk}:${index}`;

  const toggleLine = (hunk: number, index: number, line: DiffLine) => {
    if (!canApply || line.kind === "context" || line.kind === "meta") return;

    setPicked((current) => {
      const next = new Set(current);
      const id = key(hunk, index);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const pickedIn = (hunk: number) =>
    [...picked]
      .filter((id) => id.startsWith(`${hunk}:`))
      .map((id) => Number(id.split(":")[1]))
      .sort((a, b) => a - b);

  const run = (hunk: number, action: HunkAction) => {
    const lines = pickedIn(hunk);
    onHunk?.({ hunk, lines: lines.length > 0 ? lines : undefined, action });

    setPicked((current) => {
      const next = new Set(current);
      for (const id of current) if (id.startsWith(`${hunk}:`)) next.delete(id);
      return next;
    });
  };

  return (
    <div className="diff">
      <header className="diff-header">
        {diff ? (
          <>
            <span className="diff-path" {...tip(diff.path)}>
              {diff.path}
            </span>
            <span className="diff-stat">
              <span className="added">+{diff.added}</span>
              <span className="removed">&minus;{diff.removed}</span>
            </span>
            <span className="diff-timing">{diff.durationMs}ms</span>
          </>
        ) : (
          <span className="diff-path muted">{loading ? "Loading…" : emptyMessage}</span>
        )}
      </header>

      {diff?.binary ? (
        <div className="diff-notice">Binary file &mdash; no textual diff.</div>
      ) : (
        <div className="diff-body" ref={scrollRef}>
          <div className="virtual-canvas" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;

              const style = {
                height: item.size,
                transform: `translateY(${item.start}px)`,
              };

              if (row.kind === "hunk") {
                const count = pickedIn(row.hunk).length;

                return (
                  <div key={item.key} className="diff-line diff-hunk" style={style}>
                    <span className="gutter" />
                    <span className="gutter" />
                    <span className="diff-text">{row.header}</span>

                    {canApply && (
                      <span className="hunk-actions">
                        {count > 0 && (
                          <span className="hunk-count">
                            {count} {count === 1 ? "line" : "lines"}
                          </span>
                        )}

                        <button
                          className="hunk-button"
                          onClick={() => run(row.hunk, staged ? "unstage" : "stage")}
                        >
                          {staged ? "Unstage" : "Stage"}
                        </button>

                        {!staged && (
                          <button
                            className="hunk-button hunk-button-danger"
                            onClick={() => run(row.hunk, "discard")}
                          >
                            Discard
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                );
              }

              const { line } = row;
              const selectable =
                canApply && line.kind !== "context" && line.kind !== "meta";
              const isPicked = picked.has(key(row.hunk, row.index));

              return (
                <div
                  key={item.key}
                  className={[
                    "diff-line",
                    `diff-${line.kind}`,
                    selectable ? "diff-line-selectable" : "",
                    isPicked ? "diff-line-picked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={style}
                  onMouseDown={() => toggleLine(row.hunk, row.index, line)}
                >
                  <span className="gutter">{line.oldLine ?? ""}</span>
                  <span className="gutter">{line.newLine ?? ""}</span>
                  <span className="diff-marker">{markerFor(line.kind)}</span>
                  <span className="diff-text">
                    <Code
                      tokens={highlighted?.[row.hunk]?.[row.index]}
                      text={line.content}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {diff && onHunk && settings.ignoreWhitespace && (
        <div className="diff-notice">
          Staging part of a file needs the real diff. Turn off &ldquo;ignore
          whitespace&rdquo; in Settings to stage by hunk or line.
        </div>
      )}

      {diff?.truncated && (
        <div className="diff-notice">
          Diff truncated &mdash; file is too large to render in full.
        </div>
      )}
    </div>
  );
}

function markerFor(kind: DiffLine["kind"]) {
  if (kind === "added") return "+";
  if (kind === "removed") return "-";
  return " ";
}
