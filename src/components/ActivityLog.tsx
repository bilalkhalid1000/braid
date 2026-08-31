import { useState } from "react";

import { headline, type ActivityEntry } from "../lib/useActivity";

interface Props {
  entries: ActivityEntry[];
  onClear: () => void;
  onClose: () => void;
}

/** The running record of every git operation, with the output git produced.
 *
 *  The equivalent of SourceTree's console: when something behaves unexpectedly,
 *  this is where you find out what was actually run and what it said. */
export function ActivityLog({ entries, onClear, onClose }: Props) {
  return (
    <aside className="log-panel">
      <header className="log-head">
        <span className="log-title">Activity</span>
        <span className="log-count">{entries.length}</span>
        <button className="link-button" disabled={entries.length === 0} onClick={onClear}>
          clear
        </button>
        <button className="log-close" title="Close" onClick={onClose}>
          &times;
        </button>
      </header>

      <div className="log-body">
        {entries.length === 0 ? (
          <div className="pane-empty">Nothing has run yet</div>
        ) : (
          entries.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </div>
    </aside>
  );
}

function LogRow({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  const summary = headline(entry.detail);

  return (
    <div className="log-entry">
      <button className="log-entry-row" onClick={() => setOpen((v) => !v)}>
        <span className={`log-dot log-${entry.status}`} />
        <span className="log-label">{entry.label}</span>
        <span className="log-summary">{summary}</span>
        <span className="log-meta">
          {entry.durationMs !== undefined ? `${entry.durationMs}ms` : "…"}
        </span>
        <span className="log-meta">{new Date(entry.startedAt).toLocaleTimeString()}</span>
      </button>

      {open && entry.detail && <pre className="log-output">{entry.detail}</pre>}
    </div>
  );
}
