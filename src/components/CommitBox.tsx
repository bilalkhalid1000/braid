import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useTip } from "./Tip";

export interface CommitBoxHandle {
  focus: () => void;
  /** Commit what is staged, if there is anything to commit. */
  submit: () => void;
}

interface Props {
  stagedCount: number;
  busy: boolean;
  /** Whether the message box holds the keyboard, so the panel can say which
   *  keys are live: while you are typing, only Escape and the Mod combos are. */
  onEditing?: (editing: boolean) => void;
  /** Resolves false when the commit failed, so the message is not lost. */
  onCommit: (message: string, amend: boolean) => Promise<boolean>;
}

const BOX = "grid flex-none gap-3 p-4 bg-surface-alt border-t border-t-border";

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
  ({ stagedCount, busy, onCommit, onEditing }, ref) => {
    const [message, setMessage] = useState("");
    const [amend, setAmend] = useState(false);
    const textarea = useRef<HTMLTextAreaElement>(null);

    const canCommit = message.trim().length > 0 && (stagedCount > 0 || amend) && !busy;

    const submit = async () => {
      if (!canCommit) return;

      // A rejected commit — a failing hook, nothing staged, a bad signing key —
      // must not silently swallow what they typed.
      if (!(await onCommit(message, amend))) return;

      setMessage("");
      setAmend(false);
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

          <span className="ml-auto text-micro text-text-faint">{stagedCount} staged</span>

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
