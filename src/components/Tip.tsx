import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useSettings } from "../lib/settings";
import { shortcutLabel } from "../lib/shortcutLabel";

/* width: max-content matters. A fixed box with `left` set and `width: auto`
   has its shrink-to-fit width capped by the space remaining to its right, and
   the translateX that centres it only moves the box afterwards -- it hands back
   no room. So a control near the right edge got a tip a few characters wide
   that broke its own words to fit. max-content sizes to the text and leaves the
   limiting to max-width, which also makes the width measured below the real
   one, so the clamp that keeps the tip on screen has something true to work
   from. */
const TIP =
  "fixed z-30 flex w-max max-w-[min(460px,90vw)] items-center gap-3 px-4 py-2 " +
  "bg-chrome-alt border border-border rounded-sm shadow-pop text-small " +
  "pointer-events-none -translate-x-1/2 animate-tip-in";

/** Wider than this and the control is a row, not a button. */
const WIDE = 200;
const DELAY = 350;
/** How often an open tip checks that its subject is still there. */
export const GONE_CHECK_MS = 120;
const GAP = 8;
/** Keep this much clear of every window edge. */
const MARGIN = 8;

interface Anchor {
  label: string;
  keys: string;
  note?: string;
  /** Centre of the trigger, in viewport coordinates. */
  x: number;
  /** Distance from the relevant window edge to the trigger. */
  y: number;
  /** Above the trigger, for anything near the bottom of the window. */
  above: boolean;
}

interface TipHandlers {
  onMouseEnter: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onPointerDown: () => void;
}

interface TipContextValue {
  /** Spread onto any control to give it a tip showing its key. */
  tip: (label: string, commandId?: string, note?: string) => TipHandlers;
}

const TipContext = createContext<TipContextValue | null>(null);

/** The app's only tooltip.
 *
 *  Native `title` tips appear under the cursor, so on a row of buttons the tip
 *  for one lands on top of its neighbours — and they can only carry text, which
 *  forced shortcuts to be written out as "Merge – M" in some places while being
 *  drawn as key caps in others. One tip, rendering one key cap, means a
 *  shortcut looks the same everywhere it appears.
 */
export function TipProvider({ children }: { children: ReactNode }) {
  const { keymap } = useSettings();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const timer = useRef(0);
  const element = useRef<HTMLDivElement>(null);
  /** What the tip is describing, so it can notice when that thing is gone. */
  const trigger = useRef<HTMLElement | null>(null);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setAnchor(null);
    setLeft(null);
  }, []);

  const open = useCallback(
    (target: HTMLElement, label: string, commandId?: string, note?: string, pointerX?: number) => {
      window.clearTimeout(timer.current);

      trigger.current = target;

      timer.current = window.setTimeout(() => {
        const box = target.getBoundingClientRect();
        // Anything past the middle of the window opens upward, so a status bar
        // control is never described by a tip that falls off the bottom.
        const above = box.top > window.innerHeight / 2;

        // Centred on the control, unless the control is a whole row. A
        // sidebar row is as wide as the sidebar, and a tip centred on it lands
        // in the middle of nothing -- half a panel away from the word being
        // pointed at. For those, the pointer is the better anchor.
        const wide = box.width > WIDE && pointerX !== undefined;

        setLeft(null);
        setAnchor({
          label,
          keys: commandId ? shortcutLabel(keymap[commandId]) : "",
          note,
          x: wide ? pointerX : box.left + box.width / 2,
          y: above ? window.innerHeight - box.top + GAP : box.bottom + GAP,
          above,
        });
      }, DELAY);
    },
    [keymap],
  );

  /** Close when the thing being described stops existing.
   *
   *  A control can be removed while the pointer is still resting on it -- the
   *  running-git indicator disappears the moment the last command finishes --
   *  and React fires no mouseleave for an element that is simply gone. Nothing
   *  else was ever going to tell the tip to close, so it sat there describing
   *  something that was not on screen any more.
   *
   *  Polled rather than observed, because it is not only removal that matters:
   *  a control hidden by its parent, or one whose row was replaced under the
   *  cursor, leaves the tip just as stranded. Only runs while a tip is up.
   */
  useEffect(() => {
    if (!anchor) return;

    const check = window.setInterval(() => {
      if (!trigger.current?.isConnected) hide();
    }, GONE_CHECK_MS);

    return () => window.clearInterval(check);
  }, [anchor, hide]);

  // Keeping the tip on screen needs its width, and its width depends on its
  // text — a long repository path is far wider than a toolbar label. So it is
  // measured once laid out and then clamped, rather than guessed at.
  useLayoutEffect(() => {
    if (!anchor || !element.current) return;

    const half = element.current.getBoundingClientRect().width / 2;
    const lowest = half + MARGIN;
    const highest = window.innerWidth - half - MARGIN;

    // A tip wider than the window centres instead of picking an edge to hang
    // off, which at least keeps the middle of the text readable.
    setLeft(lowest > highest ? window.innerWidth / 2 : Math.min(Math.max(anchor.x, lowest), highest));
  }, [anchor]);

  const value = useMemo<TipContextValue>(
    () => ({
      tip: (label, commandId, note) => ({
        onMouseEnter: (e) => open(e.currentTarget, label, commandId, note, e.clientX),
        onMouseLeave: hide,
        onFocus: (e) => open(e.currentTarget, label, commandId, note),
        onBlur: hide,
        // Pressing something answers the question the tip was asking. Leaving
        // it up is how a tooltip ends up hovering over a tab being dragged.
        onPointerDown: hide,
      }),
    }),
    [open, hide],
  );

  return (
    <TipContext.Provider value={value}>
      {children}

      {anchor && (
        <div
          className={TIP}
          role="tooltip"
          ref={element}
          style={{
            left: left ?? anchor.x,
            ...(anchor.above ? { bottom: anchor.y } : { top: anchor.y }),
            // Hidden for the single frame between laying out and measuring, so
            // the tip never appears at the wrong place first.
            visibility: left === null ? "hidden" : "visible",
          }}
        >
          <span className="min-w-0 [overflow-wrap:anywhere] text-text">{anchor.label}</span>
          {anchor.keys && <kbd className="flex-none bg-chrome">{anchor.keys}</kbd>}
          {anchor.note && <span className="whitespace-pre-line text-text-faint">{anchor.note}</span>}
        </div>
      )}
    </TipContext.Provider>
  );
}

export function useTip(): TipContextValue["tip"] {
  const value = useContext(TipContext);
  // Outside a provider a tip is simply absent rather than a crash: a missing
  // tooltip should never take a window down.
  return (
    value?.tip ??
    (() => ({
      onMouseEnter() {},
      onMouseLeave() {},
      onFocus() {},
      onBlur() {},
      onPointerDown() {},
    }))
  );
}
