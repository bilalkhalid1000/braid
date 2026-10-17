import { useEffect, useRef, useState } from "react";

/** `value` for display, steadied: shown only once it has been non-null for
 *  `showAfter`, and kept for `holdFor` after it goes back to null.
 *
 *  For the status bar's "running" indicators. Most git calls take tens of
 *  milliseconds, and each one put a label up and took it down again, shoving
 *  everything beside it along -- a flicker that read as the app glitching.
 *  A call too quick to read is now never shown, and a run of calls back to
 *  back reads as one. */
export function useSteady<T>(value: T | null, showAfter: number, holdFor: number): T | null {
  const [shown, setShown] = useState<T | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const visible = shown !== null;
  const active = value !== null;

  // While visible, follow the value as it changes.
  useEffect(() => {
    if (visible && value !== null) setShown(value);
  }, [visible, value]);

  useEffect(() => {
    if (active === visible) return;
    const timer = window.setTimeout(
      () => setShown(latest.current),
      active ? showAfter : holdFor,
    );
    return () => window.clearTimeout(timer);
  }, [active, visible, showAfter, holdFor]);

  return shown;
}
