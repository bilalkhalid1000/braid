import { useState } from "react";

import { headline, type ActivityEntry } from "../lib/useActivity";
import { hintFor, type HintAction } from "../lib/gitHints";

interface Props {
  toasts: ActivityEntry[];
  onDismiss: (id: number) => void;
  onAction: (kind: HintAction) => void;
}

export function Toaster({ toasts, onDismiss, onAction }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="toaster">
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

  const summary = headline(entry.detail);
  // Only failures get interpreted. A successful command's output is already
  // the thing the user wanted to read.
  const hint = entry.status === "error" ? hintFor(entry.detail) : undefined;
  const hasMore = entry.detail.trim() !== summary;

  return (
    <div className={`toast toast-${entry.status}`}>
      <div className="toast-row">
        <span className="toast-mark">{entry.status === "error" ? "!" : "✓"}</span>
        <span className="toast-label">{entry.label}</span>
        <span className="toast-time">
          {entry.durationMs !== undefined && `${entry.durationMs}ms`}
        </span>
        <button className="toast-close" title="Dismiss" onClick={onDismiss}>
          &times;
        </button>
      </div>

      {/* The interpretation leads, because it is the part that is actionable.
          Git's own words stay directly underneath rather than being replaced. */}
      {hint && <p className="toast-hint">{hint.message}</p>}

      {summary ? (
        <p className="toast-detail">{summary}</p>
      ) : (
        entry.status === "success" && <p className="toast-detail muted">Done</p>
      )}

      <div className="toast-footer">
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
          <button className="toast-expand" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide output" : "Show output"}
          </button>
        )}
      </div>

      {expanded && <pre className="toast-output">{entry.detail}</pre>}
    </div>
  );
}
