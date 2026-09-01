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
export const CommitDetail = forwardRef<CommitDetailHandle, Props>(function CommitDetail(
  { repoId, oid, focused }: Props,
  ref,
) {
  const { settings } = useSettings();
  const [selected, setSelected] = useState<string | null>(null);
  const [listWidth, setListWidth] = usePaneSize("commit-files", 380);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tip = useTip();

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
      className="commit"
      style={{ gridTemplateColumns: `${listWidth}px 4px minmax(0, 1fr)` }}
    >
      <div className="commit-left">
        <header className="commit-head">
          <h2 className="commit-subject">{commit.subject}</h2>

          <p className="commit-meta">
            <button
              className="commit-oid"
              {...tip("Copy the full hash")}
              onClick={() => void navigator.clipboard.writeText(commit.oid)}
            >
              {commit.short}
            </button>
            <span>{commit.author}</span>
            <span {...tip(new Date(commit.timestamp * 1000).toLocaleString())}>
              {relativeTime(commit.timestamp)}
            </span>
            {commit.parents.length > 1 && <span className="commit-merge">merge</span>}
          </p>

          {commit.body && <p className="commit-body">{commit.body}</p>}
        </header>

        {/* Doubles as the legend: it names both quantities in their own colours,
            right above the bars that use them. */}
        <div className="commit-summary">
          <span>
            {files.length} {files.length === 1 ? "file" : "files"}
          </span>
          <span className="added">+{commit.additions.toLocaleString()}</span>
          <span className="removed">&minus;{commit.deletions.toLocaleString()}</span>
        </div>

        <div className="commit-files" ref={scrollRef}>
          <div className="virtual-canvas" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const file = files[item.index];
              if (!file) return null;

              return (
                <div
                  key={item.key}
                  className={[
                    "commit-file",
                    file.path === selected && "commit-file-selected",
                    file.path === selected && focused && "commit-file-cursor",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                  onMouseDown={() => setSelected(file.path)}
                  {...tip(
                    file.oldPath ? `${file.oldPath} → ${file.path}` : file.path,
                  )}
                >
                  <span className="commit-file-path">
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

      <div className="commit-right">
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
      <span className="commit-file-stat">
        <span className="commit-file-binary">binary</span>
      </span>
    );
  }

  const scale = largest > 0 ? 100 / largest : 0;

  return (
    <span className="commit-file-stat">
      <span className="commit-file-counts">
        {file.additions > 0 && <span className="added">+{file.additions}</span>}
        {file.deletions > 0 && <span className="removed">&minus;{file.deletions}</span>}
      </span>

      <span className="meter" aria-hidden="true">
        <span className="meter-add" style={{ width: `${file.additions * scale}%` }} />
        <span className="meter-del" style={{ width: `${file.deletions * scale}%` }} />
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
  if (cut === -1) return <span className="path-name">{path}</span>;

  return (
    <>
      <span className="path-dir" dir="rtl">
        {path.slice(0, cut + 1)}
      </span>
      <span className="path-name">{path.slice(cut + 1)}</span>
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
