import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** How long a notice stays up. Long enough to read four words, short enough
 *  not to still be there when you look back. */
const NOTICE_MS = 1600;

const NoticeContext = createContext<((message: string) => void) | null>(null);

/* Bottom centre, clear of the status bar. Deliberately not the bottom right,
   where the toasts stack: a toast reports something git did and stays until
   dismissed if it failed, and this is neither -- it is the app repeating what
   just happened so you do not have to go and check. */
const PILL =
  "fixed bottom-[46px] left-1/2 z-[16] -translate-x-1/2 rounded-lg border border-border " +
  "bg-chrome px-6 py-2 text-small text-text shadow-pop animate-fade-in " +
  "pointer-events-none";

/** Somewhere to say that something just happened, for the actions that produce
 *  no other evidence.
 *
 *  Copying is the case it exists for. It changes nothing on screen, so without
 *  this a successful copy and a missed click look identical, and the only way
 *  to tell them apart is to paste somewhere and look. */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const notify = useCallback((next: string) => {
    setMessage(next);
    // Restart the clock rather than queueing. Two copies in a row is one
    // person repeating themselves, not two things to read in turn.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), NOTICE_MS);
  }, []);

  return (
    <NoticeContext.Provider value={notify}>
      {children}
      {/* Polite: this is a confirmation, and interrupting whatever a screen
          reader is saying to repeat what the user just did is not helpful. */}
      <div role="status" aria-live="polite">
        {message && <div className={PILL}>{message}</div>}
      </div>
    </NoticeContext.Provider>
  );
}

/** Show a transient confirmation. A no-op outside the provider, so a component
 *  rendered in isolation does not have to care. */
export function useNotice() {
  return useContext(NoticeContext) ?? (() => {});
}
