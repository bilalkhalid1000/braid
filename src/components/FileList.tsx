import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { badgeFor, type StatusEntry } from "../lib/api";
import { useTip } from "./Tip";

const PANE =
  "grid grid-rows-[auto_minmax(0,1fr)] min-h-0 border-b border-b-border-soft";

const HEADER =
  "flex h-12 items-center gap-4 px-4 bg-surface-alt border-b border-b-border-soft " +
  "text-small font-semibold tracking-[0.02em] text-text-dim";

/* Absolutely placed: the list is virtualized, so each row is positioned by its
   measurement rather than by flow. */
const ROW =
  "absolute top-0 left-0 flex w-full items-center gap-3 px-4 border-l-2 cursor-default " +
  "[&_input[type=checkbox]]:m-0 [&_input[type=checkbox]]:accent-accent";

const ROW_HEIGHT = 22;

/** Git's status letters, spelled out. The letters stay — they are what git and
 *  every other client use — but nobody should have to remember them. */
const BADGE_TITLES: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  "?": "Untracked",
  "!": "Conflicted",
};

interface Props {
  title: string;
  entries: StatusEntry[];
  staged: boolean;
  selectedPath: string | null;
  onSelect: (entry: StatusEntry) => void;
  /** Checkbox toggle: stages an unstaged file, unstages a staged one. */
  onToggle: (entry: StatusEntry) => void;
  onToggleAll: () => void;
  /** Right-click on a row. Omitted where a list has no per-file actions. */
  onMenu?: (entry: StatusEntry, point: { x: number; y: number }) => void;
  actionLabel: string;
  /** The command the action button runs, so its tip can show the key. */
  actionCommand?: string;
  emptyMessage: string;
}

/** One of the two panes in the File Status view.
 *
 *  Virtualized because a `git reset` on a large tree can leave tens of
 *  thousands of files in this list. */
export function FileList({
  title,
  entries,
  staged,
  selectedPath,
  onSelect,
  onToggle,
  onToggleAll,
  onMenu,
  actionLabel,
  actionCommand,
  emptyMessage,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tip = useTip();

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  // Keep the keyboard selection on screen without yanking the whole list.
  const index = entries.findIndex((entry) => entry.path === selectedPath);
  useEffect(() => {
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [index, virtualizer]);

  return (
    <section className={PANE}>
      <header className={HEADER}>
        <span>{title}</span>
        <span className="font-mono font-normal text-text-faint">{entries.length}</span>
        <button
          className="link-button"
          disabled={entries.length === 0}
          onClick={onToggleAll}
          {...tip(actionLabel, actionCommand)}
        >
          {actionLabel}
        </button>
      </header>

      <div className="relative overflow-y-auto bg-surface" ref={scrollRef}>
        <div className="virtual-canvas" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const entry = entries[item.index];
            if (!entry) return null;

            const badge = badgeFor(entry, staged);
            const meaning = BADGE_TITLES[badge] ?? "Changed";

            return (
              <div
                key={item.key}
                className={`${ROW} ${
                  entry.path === selectedPath
                    ? "bg-select border-l-accent"
                    : "border-l-transparent hover:bg-surface-alt"
                }`}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                onMouseDown={() => onSelect(entry)}
                onDoubleClick={() => onToggle(entry)}
                onContextMenu={(e) => {
                  if (!onMenu) return;
                  e.preventDefault();
                  // Right-clicking selects too, so the menu and the diff on
                  // screen are always talking about the same file.
                  onSelect(entry);
                  onMenu(entry, { x: e.clientX, y: e.clientY });
                }}
              >
                <input
                  type="checkbox"
                  checked={staged}
                  aria-label={`${staged ? "Unstage" : "Stage"} ${entry.path}`}
                  // Out of the tab order deliberately. A checkbox counts as an
                  // input, and single-key shortcuts are suppressed while one
                  // has focus -- so in a list that can hold tens of thousands
                  // of rows, tabbing through them is both endless and a dead
                  // zone where none of the panel's keys answer. The keyboard
                  // route to the same thing is the selection plus Space.
                  tabIndex={-1}
                  onChange={() => onToggle(entry)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className={`badge badge-${badgeClass(badge)}`} {...tip(meaning)}>
                  {badge}
                </span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-small" {...tip(entry.path, undefined, meaning)}>
                  <PathLabel path={entry.path} />
                </span>
                {entry.origPath && <span className="ml-auto whitespace-nowrap font-mono text-micro text-text-faint">was {entry.origPath}</span>}
              </div>
            );
          })}
        </div>

        {entries.length === 0 && <div className="pane-empty">{emptyMessage}</div>}
      </div>
    </section>
  );
}

function badgeClass(badge: string) {
  if (badge === "?") return "untracked";
  if (badge === "!") return "conflict";
  return badge.toLowerCase();
}

/** Dim the directory so the filename is what the eye lands on. */
function PathLabel({ path }: { path: string }) {
  const cut = path.lastIndexOf("/");
  if (cut === -1) return <span>{path}</span>;

  return (
    <>
      <span className="text-text-dim">{path.slice(0, cut + 1)}</span>
      <span>{path.slice(cut + 1)}</span>
    </>
  );
}
