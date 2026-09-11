import { useCallback, useRef, useState } from "react";

export type ActivityStatus = "running" | "success" | "error";

export interface ActivityEntry {
  id: number;
  label: string;
  status: ActivityStatus;
  /** Whatever git printed. Empty for commands that say nothing on success. */
  detail: string;
  startedAt: number;
  durationMs?: number;
  /** Which control started this, so that control can show it is working.
   *  Absent for anything not launched from a button. */
  source?: string;
  /** Which repository it ran in. A fetch in one tab must not spin the Fetch
   *  button of another, and it used to: the running list was one list. */
  repo?: string;
  /** A way to take it back, offered on the toast. Only for operations that
   *  moved something -- a pull that brought commits in -- and only once the
   *  result is known, which is why it is decided after the run. */
  undo?: () => void;
}

const MAX_ENTRIES = 200;
const SUCCESS_TOAST_MS = 3200;
/** A toast with an undo on it stays up long enough to be taken. */
const UNDO_TOAST_MS = 9000;

/** Every git action the user triggers goes through here.
 *
 *  One place to record what was attempted, whether it worked, how long it took,
 *  and exactly what git said — which is what turns a silent GUI into one you
 *  can trust when an operation does something surprising. */
export function useActivity() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [toastIds, setToastIds] = useState<number[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback(
    (id: number) => setToastIds((ids) => ids.filter((i) => i !== id)),
    [],
  );

  const clear = useCallback(() => {
    setEntries([]);
    setToastIds([]);
  }, []);

  const run = useCallback(
    async (
      label: string,
      action: () => Promise<unknown>,
      source?: string,
      /** Given the result, a way to undo it -- or nothing, when there is
       *  nothing to undo, as after a pull that was already up to date. */
      undoFor?: (result: unknown) => (() => void) | undefined,
      repo?: string,
    ): Promise<boolean> => {
      const id = nextId.current++;
      const startedAt = Date.now();

      setEntries((prev) =>
        [
          { id, label, status: "running" as const, detail: "", startedAt, source, repo },
          ...prev,
        ].slice(
          0,
          MAX_ENTRIES,
        ),
      );

      const finish = (status: ActivityStatus, detail: string, undo?: () => void) => {
        setEntries((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? { ...entry, status, detail, durationMs: Date.now() - startedAt, undo }
              : entry,
          ),
        );

        setToastIds((ids) => [id, ...ids]);

        // Successes get out of the way on their own; failures stay until the
        // user has actually seen them.
        if (status === "success") {
          window.setTimeout(() => dismiss(id), undo ? UNDO_TOAST_MS : SUCCESS_TOAST_MS);
        }
      };

      try {
        const result = await action();
        finish("success", typeof result === "string" ? result.trim() : "", undoFor?.(result));
        return true;
      } catch (error) {
        finish("error", messageOf(error));
        return false;
      }
    },
    [dismiss],
  );

  /** Record something that already happened, without running it.
   *
   *  Used for results the app produced itself rather than by invoking git —
   *  a restore that skipped repositories, for instance. */
  const note = useCallback(
    (label: string, detail: string, status: "success" | "error") => {
      const id = nextId.current++;

      setEntries((prev) =>
        [
          { id, label, status, detail, startedAt: Date.now(), durationMs: 0 },
          ...prev,
        ].slice(0, MAX_ENTRIES),
      );

      setToastIds((ids) => [id, ...ids]);
      if (status === "success") window.setTimeout(() => dismiss(id), SUCCESS_TOAST_MS);
    },
    [dismiss],
  );

  const running = entries.filter((entry) => entry.status === "running");
  const errorCount = entries.filter((entry) => entry.status === "error").length;

  const toasts = toastIds
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is ActivityEntry => entry !== undefined);

  return { entries, running, toasts, errorCount, run, note, dismiss, clear };
}

/** Tauri rejects with our serialized error string, but a thrown JS Error or a
 *  plain object can also reach here, so normalize all three. */
export function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
}

/** Git's useful sentence is rarely the first one: it prefixes progress and
 *  hints around it. Prefer a `fatal:`/`error:` line when there is one. */
export function headline(detail: string): string {
  const lines = detail
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";

  const notable = lines.find(
    (line) => line.startsWith("fatal:") || line.startsWith("error:"),
  );

  return notable ?? lines[0];
}
