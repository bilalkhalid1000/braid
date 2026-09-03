import { useState } from "react";

import { headline, type ActivityEntry } from "../lib/useActivity";
import { hintFor, type HintAction } from "../lib/gitHints";
import { useTip } from "./Tip";

interface Props {
  toasts: ActivityEntry[];
  onDismiss: (id: number) => void;
  onAction: (kind: HintAction) => void;
}

/* Bottom right, stacking upwards: column-reverse puts the newest nearest the
   corner, so a burst of them grows away from the pointer rather than under it.
   Clear of the status bar, which is 34px and always there. */
const STACK =
  "fixed right-6 bottom-[34px] z-[15] flex w-[340px] max-h-[calc(100vh-80px)] " +
  "flex-col-reverse gap-4 overflow-y-auto";

const TOAST =
  "py-4 px-6 bg-chrome border border-border border-l-[3px] rounded-lg " +
  "shadow-pop animate-toast-in";

/* Everything under the first row lines up with the label rather than the mark:
   15px of mark plus the 8px gap. The mark is punctuation, not a column. */
const INDENT = "ml-[23px]";

const MARK =
  "flex-none size-[15px] rounded-full text-center text-micro font-bold leading-[15px] text-white";

export function Toaster({ toasts, onDismiss, onAction }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className={STACK}>
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          entry={toast}
          onDismiss={() => onDismiss(toast.id)}
          onAction={onAction}
        />
      ))}
    </div>
  );
}

function Toast({
  entry,
  onDismiss,
  onAction,
}: {
  entry: ActivityEntry;
  onDismiss: () => void;
  onAction: (kind: HintAction) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tip = useTip();

  const summary = headline(entry.detail);
  // Only failures get interpreted. A successful command's output is already
  // the thing the user wanted to read.
  const hint = entry.status === "error" ? hintFor(entry.detail) : undefined;
  const hasMore = entry.detail.trim() !== summary;
  const failed = entry.status === "error";
  const succeeded = entry.status === "success";

  return (
    <div
      className={`${TOAST} ${
        failed ? "border-l-removed" : succeeded ? "border-l-added" : "border-l-text-faint"
      }`}
    >
      <div className="flex items-center gap-4">
        <span
          className={`${MARK} ${failed ? "bg-removed" : succeeded ? "bg-added" : ""}`}
        >
          {failed ? "!" : "✓"}
        </span>
        <span className="flex-1 overflow-hidden font-semibold text-ellipsis whitespace-nowrap">
          {entry.label}
        </span>
        <span className="font-mono text-micro text-text-faint">
          {entry.durationMs !== undefined && `${entry.durationMs}ms`}
        </span>
        <button
          className="border-0 bg-transparent text-lead leading-none text-text-faint cursor-pointer hover:text-text"
          {...tip("Dismiss")}
          onClick={onDismiss}
        >
          &times;
        </button>
      </div>

      {/* The interpretation leads, because it is the part that is actionable.
          Git's own words stay directly underneath rather than being replaced. */}
      {hint && (
        <p className={`select-text mt-3 mb-0 ${INDENT} text-body leading-[1.45] text-text`}>
          {hint.message}
        </p>
      )}

      {summary ? (
        <p
          className={`select-text mt-2 mb-0 ${INDENT} font-mono text-small leading-[1.45] break-words text-text-dim`}
        >
          {summary}
        </p>
      ) : (
        succeeded && (
          <p className={`mt-2 mb-0 ${INDENT} text-small leading-[1.45] text-text-faint`}>
            Done
          </p>
        )
      )}

      <div className={`flex items-center gap-6 empty:hidden ${INDENT}`}>
        {hint?.action && (
          <button
            className="btn-primary btn-small"
            onClick={() => {
              onAction(hint.action!.kind);
              onDismiss();
            }}
          >
            {hint.action.label}
          </button>
        )}

        {hasMore && (
          <button
            className="border-0 bg-transparent pt-1 text-small text-accent cursor-pointer"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide output" : "Show output"}
          </button>
        )}
      </div>

      {expanded && (
        <pre
          className={`select-text mt-3 mb-0 ${INDENT} max-h-[180px] overflow-auto p-3 bg-surface border border-border-soft rounded-sm font-mono text-small whitespace-pre-wrap break-words`}
        >
          {entry.detail}
        </pre>
      )}
    </div>
  );
}
