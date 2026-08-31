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
  /** Resolves false when the commit failed, so the message is not lost. */
  onCommit: (message: string, amend: boolean) => Promise<boolean>;
}

/** The commit message box.
 *
 *  Submitting is exposed as a handle rather than bound to a key here, so the
 *  keystroke that commits stays a setting like every other one instead of being
 *  hard-coded inside a textarea. */
export const CommitBox = forwardRef<CommitBoxHandle, Props>(
  ({ stagedCount, busy, onCommit }, ref) => {
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
      <div className="commit-box">
        <textarea
          ref={textarea}
          className="commit-message"
          placeholder="Commit message"
          value={message}
          spellCheck={false}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />

        <div className="commit-actions">
          <label className="amend-toggle">
            <input
              type="checkbox"
              checked={amend}
              onChange={(e) => setAmend(e.target.checked)}
            />
            Amend
          </label>

          <span className="commit-hint">{stagedCount} staged</span>

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
