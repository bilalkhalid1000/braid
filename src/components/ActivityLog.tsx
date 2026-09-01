import { useState } from "react";

import { headline, type ActivityEntry } from "../lib/useActivity";
import { useTip } from "./Tip";
import { commandTime, gitCommandLine, type GitLog } from "../lib/useGitLog";

interface Props {
  entries: ActivityEntry[];
  git: GitLog;
  onClear: () => void;
  onClose: () => void;
}

type Tab = "activity" | "commands";

const PANEL =
  "grid grid-rows-[auto_minmax(0,1fr)] min-h-0 bg-chrome border-l border-l-border";

const HEAD =
  "flex h-row-lg items-center gap-4 px-4 bg-surface-alt border-b border-b-border-soft " +
  "text-small font-semibold";

const TAB =
  "px-2 bg-transparent border-0 border-b-2 [font:inherit] cursor-pointer";

const META = "font-mono text-micro text-text-faint whitespace-nowrap";

/* A run of commands reads as a block, so the rule goes between rows rather
   than under every one -- which would put a line under the last row with
   nothing beneath it to separate. */
const GIT_ROW =
  "flex items-baseline gap-3 px-4 py-[3px] font-mono text-micro leading-[1.55] " +
  "hover:bg-surface-alt [&:not(:first-child)]:border-t " +
  "[&:not(:first-child)]:border-t-border-soft";

const DOT: Record<ActivityEntry["status"], string> = {
  success: "bg-added",
  error: "bg-removed",
  running: "bg-accent animate-dot-pulse",
};

/** The running record of every git operation, with the output git produced.
 *
 *  The equivalent of SourceTree's console: when something behaves unexpectedly,
 *  this is where you find out what was actually run and what it said. */
export function ActivityLog({ entries, git, onClear, onClose }: Props) {
  // Two records of the same events, answering different questions: what you
  // asked for, and what git was actually run with. Interleaving them would
  // bury one page of "Push" under thirty lines of `rev-parse`.
  const [tab, setTab] = useState<Tab>("activity");
  const tip = useTip();

  const commands = tab === "commands";
  const count = commands ? git.finished.length : entries.length;

  return (
    <aside className={PANEL}>
      <header className={HEAD}>
        <button
          className={`${TAB} ${!commands ? "border-b-accent text-text" : "border-b-transparent text-text-dim"}`}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
        <button
          className={`${TAB} ${commands ? "border-b-accent text-text" : "border-b-transparent text-text-dim"}`}
          onClick={() => setTab("commands")}
        >
          Commands
        </button>

        <span className="font-mono font-normal text-text-faint">{count}</span>
        <button
          className="link-button"
          disabled={count === 0}
          onClick={commands ? git.clear : onClear}
        >
          clear
        </button>
        <button
          className="border-0 bg-transparent text-lead leading-none text-text-faint cursor-pointer"
          {...tip("Close the log")}
          onClick={onClose}
        >
          &times;
        </button>
      </header>

      <div className="relative overflow-y-auto">
        {commands ? (
          <>
            {/* Still running, at the top, because that is the question being
                asked when something seems stuck. */}
            {git.running.map((command) => (
              <div key={command.id} className={`${GIT_ROW} text-text`}>
                <span className="flex-none tabular-nums whitespace-nowrap text-text-faint">
                  {commandTime(command.startedAt)}
                </span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-text-dim">
                  {gitCommandLine(command)}
                </span>
                <span className="spinner ml-auto flex-none" />
              </div>
            ))}

            {git.finished.length === 0 && git.running.length === 0 ? (
              <div className="pane-empty">No git commands yet</div>
            ) : (
              git.finished.map((command) => (
                <div key={command.id} className={GIT_ROW}>
                  <span className="flex-none tabular-nums whitespace-nowrap text-text-faint">
                    {commandTime(command.startedAt)}
                  </span>
                  <span
                    className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${
                      command.code === 0 ? "text-text-dim" : "text-removed"
                    }`}
                  >
                    {gitCommandLine(command)}
                  </span>
                  <span className="flex-none tabular-nums text-text-faint">
                    {command.durationMs}ms
                  </span>
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
    <div className="border-b border-b-border-soft">
      <button
        className="grid w-full grid-cols-[9px_minmax(0,auto)_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 bg-transparent border-0 text-small text-left cursor-pointer hover:bg-surface-alt"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`size-[7px] rounded-full ${DOT[entry.status]}`} />
        <span className="overflow-hidden font-semibold text-ellipsis whitespace-nowrap">
          {entry.label}
        </span>
        <span className="overflow-hidden font-mono text-micro text-text-dim text-ellipsis whitespace-nowrap">
          {summary}
        </span>
        <span className={META}>
          {entry.durationMs !== undefined ? `${entry.durationMs}ms` : "…"}
        </span>
        <span className={META}>{new Date(entry.startedAt).toLocaleTimeString()}</span>
      </button>

      {open && entry.detail && (
        <pre className="m-0 max-h-[240px] overflow-auto bg-surface pt-3 pr-4 pb-4 pl-[26px] font-mono text-small whitespace-pre-wrap break-words">
          {entry.detail}
        </pre>
      )}
    </div>
  );
}
