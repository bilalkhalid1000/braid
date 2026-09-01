import { useState } from "react";

import { headline, type ActivityEntry } from "../lib/useActivity";
import { commandTime, gitCommandLine, type GitLog } from "../lib/useGitLog";

interface Props {
  entries: ActivityEntry[];
  git: GitLog;
  onClear: () => void;
  onClose: () => void;
}

type Tab = "activity" | "commands";

/** The running record of every git operation, with the output git produced.
 *
 *  The equivalent of SourceTree's console: when something behaves unexpectedly,
 *  this is where you find out what was actually run and what it said. */
export function ActivityLog({ entries, git, onClear, onClose }: Props) {
  // Two records of the same events, answering different questions: what you
  // asked for, and what git was actually run with. Interleaving them would
  // bury one page of "Push" under thirty lines of `rev-parse`.
  const [tab, setTab] = useState<Tab>("activity");

  const commands = tab === "commands";
  const count = commands ? git.finished.length : entries.length;

  return (
    <aside className="log-panel">
      <header className="log-head">
        <button
          className={`log-tab ${!commands ? "log-tab-active" : ""}`}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
        <button
          className={`log-tab ${commands ? "log-tab-active" : ""}`}
          onClick={() => setTab("commands")}
        >
          Commands
        </button>

        <span className="log-count">{count}</span>
        <button
          className="link-button"
          disabled={count === 0}
          onClick={commands ? git.clear : onClear}
        >
          clear
        </button>
        <button className="log-close" title="Close" onClick={onClose}>
          &times;
        </button>
      </header>

      <div className="log-body">
        {commands ? (
          <>
            {/* Still running, at the top, because that is the question being
                asked when something seems stuck. */}
            {git.running.map((command) => (
              <div key={command.id} className="git-row git-row-running">
                <span className="git-at">{commandTime(command.startedAt)}</span>
                <span className="git-line">{gitCommandLine(command)}</span>
                <span className="spinner" />
              </div>
            ))}

            {git.finished.length === 0 && git.running.length === 0 ? (
              <div className="pane-empty">No git commands yet</div>
            ) : (
              git.finished.map((command) => (
                <div
                  key={command.id}
                  className={`git-row ${command.code === 0 ? "" : "git-row-failed"}`}
                >
                  <span className="git-at">{commandTime(command.startedAt)}</span>
                  <span className="git-line">{gitCommandLine(command)}</span>
                  <span className="git-time">{command.durationMs}ms</span>
                </div>
              ))
            )}
          </>
        ) : entries.length === 0 ? (
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
