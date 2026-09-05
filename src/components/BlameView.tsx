import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { api, type BlameCommit, type BlameTarget } from "../lib/api";
import { useCommands } from "../lib/useCommands";
import { Code } from "./Code";
import { highlightLines, languageOf } from "../lib/highlight";
import { useGrammar } from "../lib/useGrammar";
import { useTip } from "./Tip";

const ROW_HEIGHT = 19;

/** Lines are rejoined with this before tokenizing, to rebuild the file. */
const NEWLINE = "\n";

/** How many steps the age ramp has. Five reads as a gradient without claiming a
 *  precision the eye cannot resolve at three pixels wide. */
const FRAME = "flex h-full min-h-0 flex-col bg-surface";

const HEADER =
  "flex flex-none items-center gap-4 px-4 py-3 bg-chrome border-b border-b-border";

const SUBTLE = "font-mono text-micro text-text-dim";

const FOCUS =
  "flex flex-none items-baseline gap-6 px-4 py-3 bg-surface-alt " +
  "border-b border-b-border-soft text-small";

const FOCUS_SUMMARY = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap";

/* Absolutely placed: the lines are virtualized. `pre` because the file's own
   indentation is part of what the line says. */
const ROW =
  "absolute top-0 left-0 flex min-w-full items-center font-mono text-body " +
  "leading-[19px] whitespace-pre cursor-default";

const GUTTER =
  "flex w-[196px] flex-none items-center gap-4 overflow-hidden px-4 " +
  "text-micro whitespace-nowrap";

const AUTHOR = "flex-1 overflow-hidden text-ellipsis font-sans text-text-dim";

const LINE_NO =
  "w-24 flex-none pr-4 border-r border-r-border-soft text-right text-text-faint select-none";

/** The bar down the left of each line, opaque where the commit is recent.
 *  Spelled out step by step: a class built from a number at runtime is one
 *  Tailwind's scanner cannot see. */
const AGE = "w-[3px] flex-none self-stretch bg-accent";
const AGE_FADE = ["opacity-[0.14]", "opacity-30", "opacity-[0.48]", "opacity-70", "opacity-100"];

/* Hatched rather than solid: the line is not committed, so its "age" is not a
   measurement of anything. */
const UNCOMMITTED_AGE =
  "bg-[repeating-linear-gradient(135deg,var(--color-accent)_0_2px,transparent_2px_4px)] opacity-90";

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
  const tip = useTip();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);

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
  const grammarReady = useGrammar(language);
  const highlighted = useMemo(
    () =>
      grammarReady
        ? highlightLines(lines.map((line) => line.content).join(NEWLINE), language)
        : null,
    [lines, language, grammarReady],
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
    <div className={FRAME}>
      <header className={HEADER}>
        <span className="font-mono text-small">{target.path}</span>
        {target.rev && <span className={SUBTLE}>at {target.rev.slice(0, 7)}</span>}
        <span className="flex-1" />
        <span className={SUBTLE}>
          {lines.length.toLocaleString()} {lines.length === 1 ? "line" : "lines"}
        </span>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </header>

      {/* The commit under the cursor, spelled out. The gutter has room for a
          name and a date and nothing else, so the summary lives here. */}
      {focused && (
        <div className={FOCUS}>
          {focused.uncommitted ? (
            <span className={`${FOCUS_SUMMARY} ${focused.uncommitted ? "text-accent" : "text-text-dim"}`}>
              Not committed yet — this line is only in your working tree.
            </span>
          ) : (
            <>
              <span className="flex-none font-mono text-accent">{current!.oid.slice(0, 7)}</span>
              <span className="flex-none text-text">{focused.author}</span>
              <span className="flex-none font-mono text-micro text-text-faint">{fullDate(focused.authorTime)}</span>
              <span className={`${FOCUS_SUMMARY} ${focused.uncommitted ? "text-accent" : "text-text-dim"}`}>{focused.summary}</span>
            </>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
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
                  ROW,
                  item.index === selected
                    ? "bg-accent-soft"
                    : kin
                      ? "bg-surface-alt"
                      : "",
                  starts && "shadow-[inset_0_1px_0_var(--color-border-soft)]",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                onMouseDown={() => setSelected(item.index)}
              >
                <span
                  className={`${AGE} ${AGE_FADE[ageOf[line.oid] ?? AGE_STEPS - 1]} ${
                    commit?.uncommitted ? UNCOMMITTED_AGE : ""
                  }`}
                  aria-hidden
                />

                <span
                  className={GUTTER}
                  {...(commit ? tip(commitTitle(commit)) : {})}
                >
                  {starts && commit && (
                    <>
                      <span className="w-25 flex-none text-text-faint">
                        {commit.uncommitted ? "——" : line.oid.slice(0, 7)}
                      </span>
                      <span className={AUTHOR}>
                        {commit.uncommitted ? "Uncommitted" : commit.author}
                      </span>
                      <span className="flex-none text-text-faint">
                        {commit.uncommitted ? "" : shortDate(commit.authorTime)}
                      </span>
                    </>
                  )}
                </span>

                <span className={LINE_NO}>{line.line}</span>
                <span className="select-text pl-4">
                  <Code tokens={highlighted?.[item.index]} text={line.content} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

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
