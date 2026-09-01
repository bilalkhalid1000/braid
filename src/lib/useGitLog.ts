import { useEffect, useRef, useState } from "react";

import { onGitCommand, type GitCommand } from "./api";

/** How many finished commands to keep.
 *
 *  A status refresh runs several commands and happens on every filesystem
 *  event, so this fills quickly and its only job is to answer "what did it
 *  just do". Keeping more would cost memory to hold a history nobody scrolls. */
const MAX = 200;

/** A command with the moment it began.
 *
 *  Stamped here rather than in Rust: the end event arrives separately, so the
 *  time has to be carried across anyway, and one clock is easier to trust than
 *  two. */
export interface LoggedCommand extends GitCommand {
  startedAt: number;
}

export interface GitLog {
  /** Commands that have not reported an end yet, oldest first. */
  running: LoggedCommand[];
  /** Finished commands, newest first. */
  finished: LoggedCommand[];
  clear: () => void;
}

/** What git is doing, and what it just did.
 *
 *  Kept out of the activity log because they answer different questions. The
 *  activity log says what *you* asked for — "Push", "Delete branch feature/x".
 *  This says what git was actually run with, which is the only way to check
 *  that the two agree.
 */
export function useGitLog(): GitLog {
  const [running, setRunning] = useState<LoggedCommand[]>([]);
  const [finished, setFinished] = useState<LoggedCommand[]>([]);

  /** When each running command began, so its end can be stamped with it. */
  const startedAt = useRef(new Map<number, number>());

  // Frequent enough that a re-render per event would be wasteful; batched to
  // one update per frame instead.
  const pending = useRef<GitCommand[]>([]);
  const frame = useRef(0);

  useEffect(() => {
    const flush = () => {
      frame.current = 0;
      const batch = pending.current;
      pending.current = [];
      if (batch.length === 0) return;

      // Worked out here, not inside the setState updater below. An updater is
      // run lazily during the next render, so anything it collects into an
      // outer array is still empty when the line after it reads that array --
      // which is why finished commands were vanishing instead of being kept.
      const done: LoggedCommand[] = [];
      const begun = new Map<number, number>();

      for (const command of batch) {
        if (command.durationMs === null) {
          const when = Date.now();
          startedAt.current.set(command.id, when);
          begun.set(command.id, when);
          continue;
        }

        // Fall back to now for an end whose start was never seen -- a command
        // already running when the window opened.
        const when = startedAt.current.get(command.id) ?? Date.now();
        startedAt.current.delete(command.id);
        done.push({ ...command, startedAt: when });
      }

      // Pure: it may be called more than once for the same batch.
      setRunning((current) => {
        const next = [...current];

        for (const command of batch) {
          if (command.durationMs === null) {
            next.push({ ...command, startedAt: begun.get(command.id) ?? Date.now() });
          } else {
            const at = next.findIndex((c) => c.id === command.id);
            if (at !== -1) next.splice(at, 1);
          }
        }

        return next;
      });

      if (done.length > 0) {
        setFinished((current) => [...done.reverse(), ...current].slice(0, MAX));
      }
    };

    const stop = onGitCommand((command) => {
      pending.current.push(command);
      if (frame.current === 0) frame.current = requestAnimationFrame(flush);
    });

    return () => {
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
      void stop.then((off) => off());
    };
  }, []);

  return {
    running,
    finished,
    clear: () => setFinished([]),
  };
}

/** A command written the way you would type it. */
/** One backslash, built rather than written.
 *
 *  Escapes in this file describe other escapes, and a literal one here is a
 *  step away from meaning something else. */
const SLASH = String.fromCharCode(92);

/** Control characters, written the way a shell would take them back.
 *
 *  Several of our formats separate fields with the unit and record separators,
 *  0x1f and 0x1e. Printed raw they are invisible or arrive as tofu, so the log
 *  showed an argument that looked corrupted and could not be copied anywhere
 *  useful. */
const escapeControls = (text: string) =>
  Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    if (code > 0x1f && code !== 0x7f) return ch;

    if (code === 9) return SLASH + "t";
    if (code === 10) return SLASH + "n";
    if (code === 13) return SLASH + "r";

    return SLASH + "x" + code.toString(16).padStart(2, "0");
  }).join("");

/** One argument, quoted where it would not survive being pasted unquoted. */
const quote = (arg: string) => {
  // An empty argument is a real one, and disappears entirely without quotes.
  if (arg === "") return String.fromCharCode(34, 34);

  const shown = escapeControls(arg);
  const quoteChar = String.fromCharCode(34);
  const risky =
    shown.includes(" ") || shown.includes(quoteChar) || shown.includes("'");

  if (!risky) return shown;

  return (
    quoteChar +
    shown.split(quoteChar).join(SLASH + quoteChar) +
    quoteChar
  );
};

/** A command written the way you would type it.
 *
 *  Quoted and escaped, so the line in the log is one you could paste into a
 *  terminal and get the same command back. A commit message with spaces in it
 *  is one argument rather than several, and a separator you cannot see is
 *  worse than one spelled out. */
export const gitCommandLine = (command: GitCommand) =>
  `git ${command.args.map(quote).join(" ")}`;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The time of day a command started, to the millisecond.
 *
 *  Milliseconds because the interesting question this answers is "why did that
 *  run twice" — and two runs of the same command are routinely inside the same
 *  second, which a clock without them makes look like one. */
export function commandTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
    d.getMilliseconds(),
    3,
  )}`;
}
