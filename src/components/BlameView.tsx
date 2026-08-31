import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { api, type BlameCommit, type BlameTarget } from "../lib/api";
import { useCommands } from "../lib/useCommands";
import { useSettings } from "../lib/settings";
import { shortcutLabel } from "../lib/shortcutLabel";
import { Keys } from "./Keys";
import { Code } from "./Code";
import { highlightLines, languageOf } from "../lib/highlight";

const ROW_HEIGHT = 19;

/** Lines are rejoined with this before tokenizing, to rebuild the file. */
const NEWLINE = "\n";

/** How many steps the age ramp has. Five reads as a gradient without claiming a
 *  precision the eye cannot resolve at three pixels wide. */
const AGE_STEPS = 5;

interface Props {
  repoId: string;
  target: BlameTarget;
  /** False while a sidebar panel holds the keyboard. */
  keyboardActive: boolean;
  onClose: () => void;
}

/** Who wrote each line, and when.
 *
 *  Authorship appears once per run of lines from the same commit rather than on
 *  every line: a file is long stretches of one commit broken by a few edits, and
 *  repeating a name down forty rows buries exactly the boundaries a blame is
 *  opened to find. That leaves most of the gutter deliberately empty, so a run
 *  has to be drawn some other way — a rule where each one starts, and a spine
 *  down the left whose colour carries the commit's age.
 *
 *  The spine is the one thing here a diff cannot already tell you. "What in this
 *  file is recent" is answerable from the stripe alone, before a name is read.
 */
export function BlameView({ repoId, target, keyboardActive, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const { keymap } = useSettings();

  const blame = useQuery({
    queryKey: ["blame", repoId, target.path, target.rev],
    queryFn: () => api.blame(repoId, target.path, target.rev),
    staleTime: Infinity,
  });

  const lines = useMemo(() => blame.data?.lines ?? [], [blame.data]);
  const commits = useMemo(() => blame.data?.commits ?? {}, [blame.data]);

  // Age is ranked within this file, not against the calendar. A file untouched
  // for two years and one rewritten last week should both read top to bottom;
  // an absolute scale would paint one of them a single flat colour.
  const ageOf = useMemo(() => {
    const times = Object.values(commits)
      .filter((commit) => !commit.uncommitted)
      .map((commit) => commit.authorTime);

    if (times.length === 0) return {} as Record<string, number>;

    const oldest = Math.min(...times);
    const newest = Math.max(...times);
    const span = newest - oldest;

    const steps: Record<string, number> = {};
    for (const commit of Object.values(commits)) {
      if (commit.uncommitted) continue;

      // One commit, or a file written in a single sitting: everything in it is
      // equally the newest thing there is.
      steps[commit.oid] =
        span === 0
          ? AGE_STEPS - 1
          : Math.min(
              AGE_STEPS - 1,
              Math.floor(((commit.authorTime - oldest) / span) * AGE_STEPS),
            );
    }
    return steps;
  }, [commits]);

  // Tokenized once for the whole file, not per row: a line carries no memory
  // of the one above it, so highlighting each separately would reopen every
  // construct that spans more than one — a doc comment would colour its first
  // line and nothing else.
  const language = useMemo(() => languageOf(target.path), [target.path]);
  const highlighted = useMemo(
    () => highlightLines(lines.map((line) => line.content).join(NEWLINE), language),
    [lines, language],
  );

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const move = (delta: number) =>
    setSelected((i) => Math.min(Math.max(i + delta, 0), Math.max(lines.length - 1, 0)));

  useEffect(() => {
    if (lines.length > 0) virtualizer.scrollToIndex(selected, { align: "auto" });
  }, [selected, lines.length, virtualizer]);

  useCommands(
    {
      "blame.next": () => move(1),
      "blame.previous": () => move(-1),
      "blame.close": onClose,
    },
    keyboardActive,
  );

  const current = lines[selected];
  const focused = current ? commits[current.oid] : undefined;

  return (
    <div className="blame">
      <header className="blame-header">
        <span className="blame-path">{target.path}</span>
        {target.rev && <span className="blame-rev">at {target.rev.slice(0, 7)}</span>}
        <span className="blame-spacer" />
        <span className="blame-count">
          {lines.length.toLocaleString()} {lines.length === 1 ? "line" : "lines"}
        </span>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </header>

      {/* The commit under the cursor, spelled out. The gutter has room for a
          name and a date and nothing else, so the summary lives here. */}
      {focused && (
        <div className={`blame-focus ${focused.uncommitted ? "blame-focus-uncommitted" : ""}`}>
          {focused.uncommitted ? (
            <span className="blame-focus-summary">
              Not committed yet — this line is only in your working tree.
            </span>
          ) : (
            <>
              <span className="blame-focus-oid">{current!.oid.slice(0, 7)}</span>
              <span className="blame-focus-author">{focused.author}</span>
              <span className="blame-focus-date">{fullDate(focused.authorTime)}</span>
              <span className="blame-focus-summary">{focused.summary}</span>
            </>
          )}
        </div>
      )}

      <div className="blame-body" ref={scrollRef}>
        {blame.isPending && <div className="pane-empty">Blaming {target.path}…</div>}

        {blame.isError && (
          <div className="pane-empty pane-error">
            {String((blame.error as Error).message ?? blame.error)}
          </div>
        )}

        {blame.isSuccess && lines.length === 0 && (
          <div className="pane-empty">This file has no lines to blame.</div>
        )}

        <div className="virtual-canvas" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const line = lines[item.index];
            if (!line) return null;

            const commit = commits[line.oid];
            const starts = lines[item.index - 1]?.oid !== line.oid;
            // Every line of the commit under the cursor lights up, not only the
            // one. "What else did this commit touch here" is the question a
            // blame is usually open to answer.
            const kin = current !== undefined && line.oid === current.oid;

            return (
              <div
                key={item.key}
                className={[
                  "blame-row",
                  item.index === selected && "blame-row-selected",
                  kin && "blame-row-kin",
                  starts && "blame-row-start",
                  commit?.uncommitted && "blame-row-uncommitted",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                onMouseDown={() => setSelected(item.index)}
              >
                <span
                  className={`blame-age blame-age-${ageOf[line.oid] ?? AGE_STEPS - 1}`}
                  aria-hidden
                />

                <span className="blame-gutter" title={commit ? commitTitle(commit) : undefined}>
                  {starts && commit && (
                    <>
                      <span className="blame-oid">
                        {commit.uncommitted ? "——" : line.oid.slice(0, 7)}
                      </span>
                      <span className="blame-author">
                        {commit.uncommitted ? "Uncommitted" : commit.author}
                      </span>
                      <span className="blame-date">
                        {commit.uncommitted ? "" : shortDate(commit.authorTime)}
                      </span>
                    </>
                  )}
                </span>

                <span className="blame-line-no">{line.line}</span>
                <span className="blame-content">
                  <Code tokens={highlighted?.[item.index]} text={line.content} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {keyboardActive && (
        <p className="pane-hint">
          <Keys>
            <kbd>{shortcutLabel(keymap["blame.next"])}</kbd>
            <kbd>{shortcutLabel(keymap["blame.previous"])}</kbd> move
          </Keys>{" "}
          ·{" "}
          <Keys>
            <kbd>{shortcutLabel(keymap["blame.close"])}</kbd> close
          </Keys>
        </p>
      )}
    </div>
  );
}

function commitTitle(commit: BlameCommit) {
  if (commit.uncommitted) return "Not committed yet";

  return `${commit.summary}\n${commit.author} <${commit.authorMail}>\n${new Date(
    commit.authorTime * 1000,
  ).toLocaleString()}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Fixed width, so the dates line up as a column and can be compared by eye. A
 *  locale short date cannot: 8/31/2026 and 12/1/2026 are different widths and
 *  put the parts in different places. Built from local parts rather than
 *  toISOString, which reports the day in UTC and so is wrong all evening. */
function shortDate(seconds: number) {
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fullDate(seconds: number) {
  return new Date(seconds * 1000).toLocaleString();
}
