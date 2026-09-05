import { useEffect, useState } from "react";

/** `value`, once it has stopped changing for `ms`.
 *
 *  For the thing a cursor lands on: stepping through a list changes the
 *  selection eighteen times a second, and fetching each one's detail meant
 *  two git processes per keystroke that nobody would see the result of. The
 *  selection itself stays immediate; only what is fetched for it waits. */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);

  return settled;
}
