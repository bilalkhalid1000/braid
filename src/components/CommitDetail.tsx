import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { api, type FileStat } from "../lib/api";
import { useSettings } from "../lib/settings";
import { useCopy } from "../lib/useCopy";
import { CopyHash } from "./CopyHash";
import { DiffView } from "./DiffView";
import { Splitter, usePaneSize } from "./Splitter";
import { useTip } from "./Tip";

const ROW_HEIGHT = 22;

interface Props {
  repoId: string;
  oid: string;
  /** True while the file list holds the keyboard rather than the commit list
   *  above it, so the cursor can look like a cursor rather than a leftover. */
  focused?: boolean;
  /** Right-click on a file. What the menu offers is the app's business. */
  onFileMenu?: (path: string, at: { x: number; y: number }) => void;
}

/** Driving the file list from the view that owns the keyboard.
 *
 *  Exposed as a handle rather than lifting the selection out, because the
 *  selection is only ever read here -- it decides which diff is shown -- and
 *  moving it upward would put a piece of this component's state in another
 *  file for no one else's benefit. */
export interface CommitDetailHandle {
  /** Move the cursor, selecting the first file if nothing is selected yet. */
  move: (delta: number) => void;
  /** How many files this commit touched, so a caller can decide not to enter
   *  an empty list. */
  count: () => number;
}

/** What one commit did.
 *
 *  Replaces a dump of `git show --stat`, which is a picture git renders for a
 *  terminal: padded columns, paths abbreviated to fit a width it guessed, and a
 *  bar of plus signs capped at about twenty characters so a 1,300-line file and
 *  a 300-line one look nearly the same. Reading the numbers instead means the
 *  layout can use the width it actually has, and the bars can be true to scale.
 */
const FRAME = "grid h-full min-h-0";

/* Capped at half the pane: a long commit message must not push the file list
   off the bottom of the thing it is describing. */
const HEAD =
  "flex min-h-0 max-h-1/2 shrink basis-auto flex-col gap-2 px-6 py-4 " +
  "border-b border-b-border-soft";

const SUBJECT = "select-text m-0 flex-none text-lead font-semibold tracking-[-0.01em] leading-[1.35]";
const META = "m-0 flex flex-none items-center gap-4 text-small text-text-dim";
const MERGE_CHIP = "px-3 rounded-full bg-accent-soft text-micro text-accent";

const BODY =
  "select-text min-h-0 flex-1 basis-auto mt-2 mb-0 overflow-y-auto font-mono text-body " +
  "leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere] text-text-dim";

const SUMMARY =
  "flex h-12 flex-none items-center gap-6 px-6 bg-surface-alt " +
  "border-b border-b-border-soft text-small text-text-dim " +
  "[&_.added]:font-mono [&_.added]:font-semibold [&_.removed]:font-mono [&_.removed]:font-semibold";

/* Absolutely placed: the list is virtualized. */
const FILE_ROW =
  "absolute top-0 left-0 flex w-full items-center gap-4 px-6 border-l-2 cursor-default";

const FILE_PATH =
  "flex min-w-0 flex-1 items-baseline font-mono text-small whitespace-nowrap";

/* The directory is what gets cut; the filename is the part being named. */
const PATH_DIR =
  "min-w-0 shrink basis-auto overflow-hidden text-ellipsis [unicode-bidi:plaintext] text-text-dim";

/* A fixed width so the meters line up as a column rather than stepping in and
   out with the size of the numbers beside them. */
const COUNTS = "flex min-w-[76px] justify-end gap-3 font-mono text-micro";

const METER =
  "flex h-3 w-32 gap-[2px] overflow-hidden rounded-sm bg-border-soft";

export const CommitDetail = forwardRef<CommitDetailHandle, Props>(function CommitDetail(
  { repoId, oid, focused, onFileMenu }: Props,
  ref,
) {
  const { settings } = useSettings();
  const [selected, setSelected] = useState<string | null>(null);
  const [listWidth, setListWidth] = usePaneSize("commit-files", 380);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tip = useTip();
  const { copied, copy } = useCopy();

  const detail = useQuery({
    queryKey: ["commit", repoId, oid],
    queryFn: () => api.commitDetail(repoId, oid),
    enabled: Boolean(oid),
    staleTime: Infinity,
  });

  const files = useMemo(() => detail.data?.files ?? [], [detail.data]);

  // Bars are scaled against the largest file in the commit, so a row's length
  // means something across the list rather than only within itself.
  const largest = useMemo(
    () => files.reduce((max, file) => Math.max(max, file.additions + file.deletions), 0),
    [files],
  );

  // A different commit is a different set of files; keeping the old selection
  // would show a diff belonging to nothing on screen.
  useEffect(() => setSelected(null), [oid]);

  useImperativeHandle(ref, () => ({
    count: () => files.length,
    move: (delta: number) => {
      if (files.length === 0) return;

      const at = files.findIndex((file) => file.path === selected);
      // Nothing selected yet: down starts at the top, up at the bottom.
      const next =
        at === -1
          ? delta > 0
            ? 0
            : files.length - 1
          : Math.min(Math.max(at + delta, 0), files.length - 1);

      const file = files[next];
      if (!file) return;

      setSelected(file.path);
      virtualizer.scrollToIndex(next, { align: "auto" });
    },
  }));

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  const diff = useQuery({
    queryKey: [
      "commitFile",
      repoId,
      oid,
      selected,
      settings.diffContextLines,
      settings.ignoreWhitespace,
    ],
    queryFn: () =>
      api.commitFileDiff(
        repoId,
        oid,
        selected!,
        settings.diffContextLines,
        settings.ignoreWhitespace,
      ),
    enabled: Boolean(selected),
    staleTime: Infinity,
  });

  if (!detail.data) {
    return <div className="pane-empty">Reading commit…</div>;
  }

  const commit = detail.data;

  return (
    <div
      className={FRAME}
      style={{ gridTemplateColumns: `${listWidth}px 4px minmax(0, 1fr)` }}
    >
      <div className="flex min-h-0 flex-col border-r border-r-border">
        <header className={HEAD}>
          <h2 className={SUBJECT}>{commit.subject}</h2>

          <p className={META}>
            <CopyHash
              chip
              short={commit.short}
              copied={copied === commit.oid}
              onCopy={() => void copy(commit.oid, commit.oid, commit.short)}
            />
            <span>{commit.author}</span>
            <span {...tip(new Date(commit.timestamp * 1000).toLocaleString())}>
              {relativeTime(commit.timestamp)}
            </span>
            {commit.parents.length > 1 && <span className={MERGE_CHIP}>merge</span>}
          </p>

          {commit.body && <p className={BODY}>{commit.body}</p>}
        </header>

        {/* Doubles as the legend: it names both quantities in their own colours,
            right above the bars that use them. */}
        <div className={SUMMARY}>
          <span>
            {files.length} {files.length === 1 ? "file" : "files"}
          </span>
          <span className="added">+{commit.additions.toLocaleString()}</span>
          <span className="removed">&minus;{commit.deletions.toLocaleString()}</span>
        </div>

        <div className="relative min-h-0 flex-1 basis-auto overflow-y-auto bg-surface" ref={scrollRef}>
          <div className="virtual-canvas" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const file = files[item.index];
              if (!file) return null;

              return (
                <div
                  key={item.key}
                  className={[
                    FILE_ROW,
                    file.path === selected
                      ? "bg-select border-l-accent"
                      : "border-l-transparent hover:bg-surface-alt",
                    file.path === selected &&
                      focused &&
                      "shadow-[inset_0_0_0_1px_var(--color-accent)]",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                  onMouseDown={() => setSelected(file.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelected(file.path);
                    onFileMenu?.(file.path, { x: e.clientX, y: e.clientY });
                  }}
                  {...tip(
                    file.oldPath ? `${file.oldPath} → ${file.path}` : file.path,
                  )}
                >
                  <span className={FILE_PATH}>
                    <PathLabel path={file.path} />
                  </span>

                  <FileMeter file={file} largest={largest} />
                </div>
              );
            })}
          </div>

          {files.length === 0 && <div className="pane-empty">This commit changed nothing</div>}
        </div>
      </div>

      <Splitter axis="x" value={listWidth} onChange={setListWidth} min={260} max={640} />

      <div className="min-w-0 min-h-0">
        <DiffView
          diff={diff.data}
          loading={diff.isFetching}
          emptyMessage="Select a file to see what changed"
        />
      </div>
    </div>
  );
});

/** Additions and deletions as one bar, scaled against the biggest file here.
 *
 *  Colour alone would not carry this — red and green are the classic pair
 *  people cannot separate — so the counts sit beside it and the order is always
 *  additions then deletions. */
function FileMeter({ file, largest }: { file: FileStat; largest: number }) {
  if (file.binary) {
    return (
      <span className="flex flex-none items-center gap-3">
        <span className="min-w-[76px] text-right text-micro text-text-faint">binary</span>
      </span>
    );
  }

  const scale = largest > 0 ? 100 / largest : 0;

  return (
    <span className="flex flex-none items-center gap-3">
      <span className={COUNTS}>
        {file.additions > 0 && <span className="added">+{file.additions}</span>}
        {file.deletions > 0 && <span className="removed">&minus;{file.deletions}</span>}
      </span>

      <span className={METER} aria-hidden="true">
        <span className="h-full rounded-sm bg-added" style={{ width: `${file.additions * scale}%` }} />
        <span className="h-full rounded-sm bg-removed" style={{ width: `${file.deletions * scale}%` }} />
      </span>
    </span>
  );
}

/** The directory dimmed, the filename bright and never truncated.
 *
 *  Only the directory shrinks, and it loses characters from its front rather
 *  than its end — the part of a path nearest the file is the part that
 *  identifies it, and `AttendanceApp/dist/gui/` is far less useful than
 *  `…/dist/gui/`. */
function PathLabel({ path }: { path: string }) {
  const cut = path.lastIndexOf("/");
  if (cut === -1) return <span className="flex-none">{path}</span>;

  return (
    <>
      <span className={PATH_DIR} dir="rtl">
        {path.slice(0, cut + 1)}
      </span>
      <span className="flex-none">{path.slice(cut + 1)}</span>
    </>
  );
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

function relativeTime(seconds: number): string {
  const delta = seconds - Date.now() / 1000;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size) {
      return format.format(Math.round(delta / size), unit);
    }
  }

  return format.format(Math.round(delta), "second");
}
