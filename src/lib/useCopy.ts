import { useEffect, useRef, useState } from "react";

import { useNotice } from "./notice";

/** How long a "copied" mark stays up: long enough to read, short enough to be
 *  gone before you reach for the next thing. */
export const COPIED_MS = 1200;

/** Copy to the clipboard, remembering what was copied just long enough to say
 *  so.
 *
 *  The caller names what it copied rather than passing a flag, so one of these
 *  serves a whole list: a row asks whether *it* is the thing that was copied,
 *  and only that row lights up.
 *
 *  Copying can fail -- an unfocused document, a locked-down webview -- and a
 *  confirmation that appears anyway is worse than none, because the text is not
 *  on the clipboard and the user has stopped checking. Nothing is claimed until
 *  the write resolves. */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const notify = useNotice();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** `shown` is what the confirmation repeats back -- the abbreviation for a
   *  hash, rather than the forty characters actually copied. */
  const copy = async (id: string, text: string, shown?: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }

    notify(`Copied ${shown ?? text}`);

    setCopied(id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), COPIED_MS);
    return true;
  };

  return { copied, copy };
}
