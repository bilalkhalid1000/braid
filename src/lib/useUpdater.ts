import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStage =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string; notes: string }
  | { state: "downloading"; version: string; percent: number | null }
  | { state: "ready"; version: string }
  | { state: "upToDate" }
  | { state: "failed"; message: string };

/** Checking for, downloading and installing a new version.
 *
 *  Nothing is downloaded without being asked for. An update that installs
 *  itself the moment you open the app is an update that interrupts whatever you
 *  opened the app to do — so the check is quiet, and the install is a decision.
 */
export function useUpdater(checkOnLaunch: boolean) {
  const [stage, setStage] = useState<UpdateStage>({ state: "idle" });
  const pending = useRef<Update | null>(null);

  /** `silent` keeps a background check from reporting "you are up to date",
   *  which nobody asked to hear. */
  const checkNow = useCallback(async (silent = false) => {
    if (!silent) setStage({ state: "checking" });

    try {
      const update = await check();

      if (!update) {
        setStage(silent ? { state: "idle" } : { state: "upToDate" });
        return;
      }

      pending.current = update;
      setStage({
        state: "available",
        version: update.version,
        notes: update.body ?? "",
      });
    } catch (error) {
      // A failed check is not worth interrupting anyone over. It is reported
      // when they asked, and swallowed when they did not.
      setStage(silent ? { state: "idle" } : { state: "failed", message: String(error) });
    }
  }, []);

  const install = useCallback(async () => {
    const update = pending.current;
    if (!update) return;

    let downloaded = 0;
    let total: number | null = null;

    setStage({ state: "downloading", version: update.version, percent: null });

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setStage({
            state: "downloading",
            version: update.version,
            // A server that does not send a length gives no percentage; a
            // made-up one would be worse than none.
            percent: total ? Math.round((downloaded / total) * 100) : null,
          });
        }

        if (event.event === "Finished") {
          setStage({ state: "ready", version: update.version });
        }
      });
    } catch (error) {
      setStage({ state: "failed", message: String(error) });
    }
  }, []);

  /** Restart into the version just installed. */
  const restart = useCallback(async () => {
    try {
      await relaunch();
    } catch (error) {
      setStage({ state: "failed", message: String(error) });
    }
  }, []);

  const dismiss = useCallback(() => setStage({ state: "idle" }), []);

  useEffect(() => {
    if (!checkOnLaunch) return;

    // Delayed so it never competes with opening repositories, which is what
    // someone actually launched the app to do.
    const timer = window.setTimeout(() => void checkNow(true), 4000);
    return () => window.clearTimeout(timer);
  }, [checkOnLaunch, checkNow]);

  return { stage, checkNow, install, restart, dismiss };
}
