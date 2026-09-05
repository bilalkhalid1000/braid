import { useEffect, useRef, useState } from "react";

import type { RebaseAction, RebasePlan, RebaseStep } from "../lib/api";
import { Keys } from "./Keys";

interface Props {
  plan: RebasePlan;
  /** A commit to start with an action other than pick: what a menu entry
   *  such as "squash into its parent" asked for. */
  preset?: { oid: string; action: RebaseAction };
  onClose: () => void;
  onRun: (base: string, steps: RebaseStep[]) => void;
}

const ACTIONS: { action: RebaseAction; key: string; label: string; note: string }[] = [
  { action: "pick", key: "p", label: "pick", note: "keep as is" },
  { action: "reword", key: "r", label: "reword", note: "keep, change the message" },
  { action: "edit", key: "e", label: "edit", note: "stop here to amend" },
  { action: "squash", key: "s", label: "squash", note: "fold into the one above, keep both messages" },
  { action: "fixup", key: "f", label: "fixup", note: "fold into the one above, keep its message" },
  { action: "drop", key: "d", label: "drop", note: "leave it out" },
];

const SCRIM = "fixed inset-0 z-30 flex items-center justify-center bg-black/40";

const FRAME =
  "grid w-[720px] max-h-[calc(100vh-64px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-5 " +
  "overflow-hidden p-8 bg-chrome border border-border rounded-lg shadow-pop-lg focus:outline-none";

const ROW =
  "grid grid-cols-[92px_74px_minmax(0,1fr)] items-start gap-4 px-3 py-2 " +
  "border-l-2 rounded-sm text-body";

const SELECT =
  "w-full rounded-sm border border-border bg-surface px-2 py-[2px] font-mono text-small";

const MESSAGE =
  "w-full min-h-[64px] resize-y rounded-sm border border-border bg-surface p-2 " +
  "font-mono text-small leading-[1.5] focus:border-accent focus:outline-none";

/** Squash and fixup fold into the row above, so the first row has nowhere to
 *  fold into. */
const foldsUp = (action: RebaseAction) => action === "squash" || action === "fixup";

/** The plan for an interactive rebase, decided here rather than in a text
 *  file git opens in an editor.
 *
 *  The keys are git's own letters, so anyone who has used the todo file
 *  already knows them: p, r, e, s, f, d on a row set its action; J and K move
 *  the row. Enter on a reword opens its message. */
export function RebaseEditor({ plan, preset, onClose, onRun }: Props) {
  const [steps, setSteps] = useState<RebaseStep[]>(() =>
    plan.commits.map((commit) => ({
      action: preset?.oid === commit.oid ? preset.action : "pick",
      oid: commit.oid,
      message: commit.message,
    })),
  );
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      plan.commits.findIndex((commit) => commit.oid === preset?.oid),
    ),
  );
  const frame = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  useEffect(() => {
    frame.current?.focus();
  }, []);

  const byOid = Object.fromEntries(plan.commits.map((commit) => [commit.oid, commit]));

  const setAction = (index: number, action: RebaseAction) => {
    if (index === 0 && foldsUp(action)) return;
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, action } : step)));
  };

  const setMessage = (index: number, message: string) =>
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, message } : step)));

  const move = (from: number, delta: number) => {
    const to = from + delta;
    if (to < 0 || to >= steps.length) return;
    setSteps((current) => {
      const next = [...current];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row!);
      return next;
    });
    setCursor(to);
  };

  const kept = steps.filter((step) => step.action !== "drop").length;
  const canRun = kept > 0 && !(steps[0] && foldsUp(steps[0].action));

  const run = () => {
    if (canRun) onRun(plan.base, steps);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === "Escape") {
      e.stopPropagation();
      // Out of a message first, out of the editor second.
      if (e.target instanceof HTMLTextAreaElement) {
        e.target.blur();
        frame.current?.focus();
      } else {
        onClose();
      }
      return;
    }

    if (e.key === "Enter" && mod) {
      e.preventDefault();
      run();
      return;
    }

    // Inside a message, letters are letters.
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, steps.length - 1));
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "J" || (e.key === "ArrowDown" && e.shiftKey)) {
      e.preventDefault();
      move(cursor, 1);
    } else if (e.key === "K" || (e.key === "ArrowUp" && e.shiftKey)) {
      e.preventDefault();
      move(cursor, -1);
    } else if (e.key === "Enter") {
      const step = steps[cursor];
      if (step?.action === "reword") {
        e.preventDefault();
        messageRefs.current[step.oid]?.focus();
      }
    } else {
      const hit = ACTIONS.find((a) => a.key === e.key);
      if (hit) {
        e.preventDefault();
        setAction(cursor, hit.action);
        if (hit.action === "reword") {
          // The message is the point of a reword; go straight to it.
          setTimeout(() => messageRefs.current[steps[cursor]!.oid]?.focus(), 0);
        }
      }
    }
  };

  return (
    <div className={SCRIM} onMouseDown={onClose}>
      <div
        className={FRAME}
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-label="Interactive rebase"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="grid gap-2">
          <h2 className="m-0 text-lead font-semibold tracking-[-0.01em]">
            Rebase {plan.commits.length} {plan.commits.length === 1 ? "commit" : "commits"} onto{" "}
            <span className="font-mono">{plan.base.slice(0, 8)}</span>
          </h2>
          <p className="m-0 text-small text-text-dim">
            Oldest first, the order they will be replayed in. Every commit from the first row
            onwards gets a new hash.
            {plan.published > 0 && plan.upstream && (
              <>
                {" "}
                <span className="text-removed">
                  {plan.published} of them {plan.published === 1 ? "is" : "are"} already on{" "}
                  {plan.upstream}, so this rewrites history other people have.
                </span>
              </>
            )}
          </p>
        </div>

        <div className="min-h-0 overflow-y-auto rounded-sm border border-border-soft bg-surface p-2">
          {steps.map((step, index) => {
            const commit = byOid[step.oid];
            const current = index === cursor;

            return (
              <div
                key={step.oid}
                className={[
                  ROW,
                  current
                    ? "bg-select border-l-accent shadow-[inset_0_0_0_1px_var(--color-accent)]"
                    : "border-l-transparent hover:bg-surface-alt",
                  step.action === "drop" && "opacity-55",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseDown={() => setCursor(index)}
              >
                <select
                  className={SELECT}
                  value={step.action}
                  aria-label={`What to do with ${commit?.short ?? step.oid}`}
                  onChange={(e) => setAction(index, e.target.value as RebaseAction)}
                >
                  {ACTIONS.map((a) => (
                    <option
                      key={a.action}
                      value={a.action}
                      disabled={index === 0 && foldsUp(a.action)}
                    >
                      {a.label}
                    </option>
                  ))}
                </select>

                <span className="pt-[3px] font-mono text-small text-text-dim">
                  {commit?.short}
                </span>

                {step.action === "reword" ? (
                  <textarea
                    className={MESSAGE}
                    ref={(el) => {
                      messageRefs.current[step.oid] = el;
                    }}
                    value={step.message ?? ""}
                    spellCheck={false}
                    onChange={(e) => setMessage(index, e.target.value)}
                    onFocus={() => setCursor(index)}
                  />
                ) : (
                  <span
                    className={`pt-[3px] overflow-hidden text-ellipsis whitespace-nowrap ${
                      step.action === "drop" ? "line-through" : ""
                    }`}
                  >
                    {commit?.subject}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4">
          <p className="pane-hint m-0 flex-1 border-0 bg-transparent px-0">
            <Keys>
              <kbd>j</kbd>
              <kbd>k</kbd> move
            </Keys>{" "}
            ·{" "}
            <Keys>
              <kbd>J</kbd>
              <kbd>K</kbd> reorder
            </Keys>{" "}
            ·{" "}
            {ACTIONS.map((a) => (
              <span key={a.action}>
                <Keys>
                  <kbd>{a.key}</kbd> {a.label}
                </Keys>{" "}
                ·{" "}
              </span>
            ))}
            <Keys>
              <kbd>Ctrl+↵</kbd> rebase
            </Keys>
          </p>

          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={plan.published > 0 ? "btn-danger" : "btn-primary"}
            disabled={!canRun}
            onClick={run}
          >
            Rebase
          </button>
        </div>
      </div>
    </div>
  );
}
