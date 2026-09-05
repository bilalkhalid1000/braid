import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { DiffLine, FileDiff } from "../lib/api";
import { useSettings } from "../lib/settings";
import { pairLines, type Placed } from "../lib/splitDiff";
import { highlightHunks, languageOf } from "../lib/highlight";
import { Code } from "./Code";
import { useTip } from "./Tip";

const LINE_HEIGHT = 18;

type DiffRow =
  | { kind: "hunk"; hunk: number; header: string }
  | { kind: "line"; hunk: number; index: number; line: DiffLine }
  | { kind: "pair"; hunk: number; left?: Placed; right?: Placed };

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
const FRAME =
  "grid grid-rows-[auto_minmax(0,1fr)_auto] h-full min-h-0 flex-1 basis-auto";

const HEADER =
  "flex h-13 items-center gap-6 px-6 bg-surface-alt border-b border-b-border-soft text-small";

const PATH = "overflow-hidden text-ellipsis whitespace-nowrap font-mono";
const STAT = "flex gap-4 font-mono [&_.added]:text-added [&_.removed]:text-removed";

const NOTICE =
  "px-6 py-3 bg-surface-alt border-t border-t-border-soft text-small text-text-dim";

/* Absolutely placed: the lines are virtualized. `pre` because a diff is
   whitespace, and losing it changes what the line says. */
const LINE =
  "absolute top-0 left-0 flex min-w-full items-center font-mono text-body " +
  "leading-[18px] whitespace-pre";

/** Built from the line's kind, so every value it can take is spelled out --
 *  a class assembled at runtime is one Tailwind's scanner cannot see. */
const KIND: Record<string, string> = {
  added: "bg-added-bg text-added",
  removed: "bg-removed-bg text-removed",
  meta: "text-text-faint",
  context: "",
};

const GUTTER = "w-22 flex-none pr-4 text-right text-text-faint select-none";

/* One side of a split row. Clipped rather than scrolled: two columns that
   each scrolled sideways would never line up. */
const HALF = "flex min-w-0 flex-1 basis-0 items-center overflow-hidden";

/* Lit when the line is picked, which the line above it announces with a class
   the marker can look up at. */
const MARKER =
  "w-8 flex-none text-center select-none " +
  "group-[.is-picked]:bg-accent group-[.is-picked]:font-bold group-[.is-picked]:text-white";

/* Sticky, so the buttons stay reachable on a hunk wider than the pane. */
const HUNK_ACTIONS =
  "sticky right-4 ml-auto flex items-center gap-3 pr-4 opacity-0 " +
  "group-hover:opacity-100 focus-within:opacity-100";

const HUNK_BUTTON =
  "px-3 py-px bg-surface border border-border rounded-sm font-sans text-micro " +
  "leading-[15px] text-text-dim cursor-pointer";

export function DiffView({ diff, loading, emptyMessage, onHunk, staged }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { settings, update } = useSettings();
  const tip = useTip();

  /** Selected lines, keyed "hunk:index". Cleared whenever the file changes. */
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => setPicked(new Set()), [diff?.path, staged]);

  const split = settings.diffLayout === "split";

  const rows = useMemo<DiffRow[]>(() => {
    if (!diff) return [];

    return diff.hunks.flatMap<DiffRow>((hunk, h) => [
      { kind: "hunk", hunk: h, header: hunk.header },
      ...(split
        ? pairLines(hunk.lines).map<DiffRow>((row) => ({ kind: "pair", hunk: h, ...row }))
        : hunk.lines.map<DiffRow>((line, index) => ({ kind: "line", hunk: h, index, line }))),
    ]);
  }, [diff, split]);

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
    <div className={FRAME}>
      <header className={HEADER}>
        {diff ? (
          <>
            <span className={PATH} {...tip(diff.path)}>
              {diff.path}
            </span>
            <span className={STAT}>
              <span className="added">+{diff.added}</span>
              <span className="removed">&minus;{diff.removed}</span>
            </span>
            <button
              className="ml-auto border border-border bg-surface px-3 py-px rounded-sm text-micro text-text-dim cursor-pointer hover:text-text"
              onClick={() => update({ diffLayout: split ? "unified" : "split" })}
              {...tip(split ? "Show one column" : "Show old and new side by side", "view.diffLayout")}
            >
              {split ? "Unified" : "Side by side"}
            </button>
            <span className="font-mono text-text-faint">{diff.durationMs}ms</span>
          </>
        ) : (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-sans text-text-faint">{loading ? "Loading…" : emptyMessage}</span>
        )}
      </header>

      {diff?.binary ? (
        <div className={NOTICE}>Binary file &mdash; no textual diff.</div>
      ) : (
        <div className="overflow-auto bg-surface" ref={scrollRef}>
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
                  <div key={item.key} className={`${LINE} group bg-hunk-bg text-text-dim`} style={style}>
                    <span className={GUTTER} />
                    <span className={GUTTER} />
                    <span className="select-text pr-8">{row.header}</span>

                    {canApply && (
                      <span className={HUNK_ACTIONS}>
                        {count > 0 && (
                          <span className="font-sans text-micro text-accent">
                            {count} {count === 1 ? "line" : "lines"}
                          </span>
                        )}

                        <button
                          className={`${HUNK_BUTTON} hover:border-accent hover:text-accent`}
                          onClick={() => run(row.hunk, staged ? "unstage" : "stage")}
                        >
                          {staged ? "Unstage" : "Stage"}
                        </button>

                        {!staged && (
                          <button
                            className={`${HUNK_BUTTON} hover:border-removed hover:text-removed`}
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

              if (row.kind === "pair") {
                // Each side is its own line of the hunk, picked on its own;
                // a context line is the same line on both and picks neither.
                const side = (placed: Placed | undefined, which: "old" | "new") => {
                  if (!placed) return <span className={`${HALF} bg-surface-alt/40`} />;
                  const { line, index } = placed;
                  const selectable =
                    canApply && line.kind !== "context" && line.kind !== "meta";
                  const isPicked = picked.has(key(row.hunk, index));
                  return (
                    <span
                      className={[
                        HALF,
                        "group",
                        KIND[line.kind],
                        selectable ? "cursor-pointer" : "",
                        isPicked ? "shadow-[inset_2px_0_0_var(--color-accent)] is-picked" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onMouseDown={() => toggleLine(row.hunk, index, line)}
                    >
                      <span className={GUTTER}>
                        {(which === "old" ? line.oldLine : line.newLine) ?? ""}
                      </span>
                      <span className={MARKER}>{markerFor(line.kind)}</span>
                      <span className="pr-8">
                        <Code tokens={highlighted?.[row.hunk]?.[index]} text={line.content} />
                      </span>
                    </span>
                  );
                };

                return (
                  <div key={item.key} className={`${LINE} min-w-0 w-full`} style={style}>
                    {side(row.left, "old")}
                    <span className="w-px flex-none self-stretch bg-border-soft" />
                    {side(row.right, "new")}
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
                    LINE,
                    "group",
                    KIND[line.kind],
                    selectable ? "cursor-pointer" : "",
                    isPicked ? "shadow-[inset_2px_0_0_var(--color-accent)] is-picked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={style}
                  onMouseDown={() => toggleLine(row.hunk, row.index, line)}
                >
                  <span className={GUTTER}>{line.oldLine ?? ""}</span>
                  <span className={GUTTER}>{line.newLine ?? ""}</span>
                  <span className={MARKER}>{markerFor(line.kind)}</span>
                  <span className="pr-8">
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
        <div className={NOTICE}>
          Staging part of a file needs the real diff. Turn off &ldquo;ignore
          whitespace&rdquo; in Settings to stage by hunk or line.
        </div>
      )}

      {diff?.truncated && (
        <div className={NOTICE}>
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
