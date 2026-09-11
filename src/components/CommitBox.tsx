import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTip } from "./Tip";

export interface CommitBoxHandle {
  focus: () => void;
  /** Commit what is staged, if there is anything to commit. */
  submit: () => void;
}

interface Props {
  /** Whose draft this is. A message half-written is kept per repository,
   *  so switching to History or another tab and back does not lose it. */
  repoId: string;
  stagedCount: number;
  busy: boolean;
  /** Whether the message box holds the keyboard, so the panel can say which
   *  keys are live: while you are typing, only Escape and the Mod combos are. */
  onEditing?: (editing: boolean) => void;
  /** Resolves false when the commit failed, so the message is not lost. */
  onCommit: (message: string, amend: boolean, skipHooks: boolean) => Promise<boolean>;
  /** Messages committed earlier this session, newest first. Ctrl+Up walks
   *  back through them. */
  history?: string[];
}

const BOX = "grid flex-none gap-3 p-4 bg-surface-alt border-t border-t-border";

/** Where a subject line stops being one. Fifty is the convention git's own
 *  documentation gives; seventy-two is where `git log` starts wrapping. */
const SUBJECT_SOFT = 50;
const SUBJECT_HARD = 72;

const draftKey = (repoId: string) => `draft:${repoId}`;

function readDraft(repoId: string): string {
  try {
    return localStorage.getItem(draftKey(repoId)) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(repoId: string, message: string) {
  try {
    if (message) localStorage.setItem(draftKey(repoId), message);
    else localStorage.removeItem(draftKey(repoId));
  } catch {
    // Storage full or unavailable: the draft lives in the box until then.
  }
}

/* Resizable vertically and capped: a long message is worth room, and a box
   that can grow without limit is one that can hide the file list entirely. */
const MESSAGE =
  "min-h-[78px] max-h-[220px] resize-y p-3 bg-surface border border-border rounded-sm " +
  "font-mono text-body leading-[1.5] focus:border-accent focus:outline-none";

/** The commit message box.
 *
 *  Submitting is exposed as a handle rather than bound to a key here, so the
 *  keystroke that commits stays a setting like every other one instead of being
 *  hard-coded inside a textarea. */
export const CommitBox = forwardRef<CommitBoxHandle, Props>(
  ({ repoId, stagedCount, busy, onCommit, onEditing, history = [] }, ref) => {
    const [message, setMessageState] = useState(() => readDraft(repoId));

    const setMessage = (next: string) => {
      setMessageState(next);
      writeDraft(repoId, next);
    };

    // The box outlives a tab switch -- the status view is the same component
    // with a different repository in it -- so the draft has to be swapped by
    // hand: this repository's, not whatever the last one left in the state.
    useEffect(() => {
      setMessageState(readDraft(repoId));
      setRecalled(-1);
    }, [repoId]);

    // The first line, which is the subject whether or not a blank line
    // follows it, and how long it has grown.
    const subjectLength = (message.split("\n", 1)[0] ?? "").length;
    const secondLine = message.split("\n")[1];
    /** Which earlier message is showing, or -1 for one being written. */
    const [recalled, setRecalled] = useState(-1);
    const [amend, setAmend] = useState(false);
    const [skipHooks, setSkipHooks] = useState(false);
    const textarea = useRef<HTMLTextAreaElement>(null);

    const canCommit = message.trim().length > 0 && (stagedCount > 0 || amend) && !busy;

    const submit = async () => {
      if (!canCommit) return;

      // A rejected commit — a failing hook, nothing staged, a bad signing key —
      // must not silently swallow what they typed.
      if (!(await onCommit(message, amend, skipHooks))) return;

      setMessage("");
      setAmend(false);
      setSkipHooks(false);
      setRecalled(-1);
    };

    const tip = useTip();

    useImperativeHandle(ref, () => ({
      focus: () => textarea.current?.focus(),
      submit: () => void submit(),
    }));

    return (
      <div className={BOX}>
        <textarea
          ref={textarea}
          className={MESSAGE}
          placeholder="Commit message"
          value={message}
          spellCheck={false}
          onChange={(e) => setMessage(e.target.value)}
          onFocus={() => onEditing?.(true)}
          onBlur={() => onEditing?.(false)}
          onKeyDown={(e) => {
            // The way back out. Single-key shortcuts are suppressed while a
            // text field has focus -- correctly, or typing "a" would stage
            // everything -- so without this the keyboard has no exit.
            if (e.key === "Escape") e.currentTarget.blur();

            // Earlier messages, the way a shell recalls earlier commands.
            if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              const next = e.key === "ArrowUp" ? recalled + 1 : recalled - 1;
              if (next >= history.length) return;
              setRecalled(Math.max(next, -1));
              setMessage(next < 0 ? "" : history[next]!);
            }
          }}

        />

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-3 text-small text-text-dim">
            <input
              type="checkbox"
              className="accent-accent"
              checked={amend}
              onChange={(e) => setAmend(e.target.checked)}
            />
            Amend
          </label>

          {/* Off again after each commit: skipping a hook is a decision about
              one commit, not a mode. */}
          <label
            className="flex items-center gap-3 text-small text-text-dim"
            {...tip("Skip hooks", undefined, "Commits with --no-verify, so pre-commit and commit-msg hooks do not run.")}
          >
            <input
              type="checkbox"
              className="accent-accent"
              checked={skipHooks}
              onChange={(e) => setSkipHooks(e.target.checked)}
            />
            Skip hooks
          </label>

          {/* Said only once it matters: a counter on an empty box is noise,
              and one that turns amber at fifty and red at seventy-two says
              what the number means without a sentence. */}
          {subjectLength > SUBJECT_SOFT && (
            <span
              className={`font-mono text-micro ${
                subjectLength > SUBJECT_HARD ? "text-removed" : "text-modified"
              }`}
              {...tip(
                `Subject is ${subjectLength} characters`,
                undefined,
                subjectLength > SUBJECT_HARD
                  ? "Past 72, git log wraps it. Keep the first line short and put the rest after a blank line."
                  : "Over 50. Fine, but shorter subjects read better in a log.",
              )}
            >
              {subjectLength}/{SUBJECT_SOFT}
            </span>
          )}
          {secondLine !== undefined && secondLine.trim() !== "" && (
            <span
              className="text-micro text-modified"
              {...tip("No blank line after the subject", undefined, "Git treats everything up to the first blank line as the subject.")}
            >
              blank line?
            </span>
          )}

          <span className="ml-auto text-micro text-text-faint">
            {history.length > 0 && (
              <span className="mr-4" title="Ctrl+Up recalls an earlier message, Ctrl+Down comes back">
                <kbd>Ctrl+↑</kbd> earlier message
              </span>
            )}
            {stagedCount} staged
          </span>

          <button
            className="btn-primary"
            disabled={!canCommit}
            onClick={() => void submit()}
            {...tip("Commit", "status.commit")}
          >
            Commit
          </button>
        </div>
      </div>
    );
  },
);

CommitBox.displayName = "CommitBox";
