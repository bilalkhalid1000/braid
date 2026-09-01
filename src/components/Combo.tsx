import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { matchesFilter } from "./FilterInput";

export interface ComboOption {
  value: string;
  /** Shown dimmed on the right — where a branch already is, usually. */
  note?: string;
}

interface Props {
  value: string;
  options: ComboOption[];
  placeholder?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

const MAX_SHOWN = 8;

/** Type to filter, or type something new.
 *
 *  Not a `<select>`: the whole point is that a name which is *not* in the list
 *  is a legitimate answer — that is how a new branch gets made. So it stays a
 *  text field, and the list narrows underneath it as a way of finding what
 *  already exists rather than a fence around what is allowed.
 */
export function Combo({
  value,
  options,
  placeholder,
  autoFocus,
  onChange,
  inputRef,
}: Props) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  /** Whether anything has been typed since the list opened.
   *
   *  Until it has, the list shows everything. A field arrives pre-filled with
   *  a whole branch name, and filtering by it on open means opening the list
   *  shows you the answer you already had and hides every alternative --
   *  the one moment you are certainly looking for something else. */
  const [typed, setTyped] = useState(false);
  const blurTimer = useRef(0);
  const field = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const shown = useMemo(() => {
    const matched = typed
      ? options.filter((option) => matchesFilter(option.value, value))
      : options;

    return { matched: matched.slice(0, MAX_SHOWN), total: matched.length };
  }, [options, value, typed]);

  // Measured against the viewport and rendered into the body, because the list
  // is taller than the box that holds it. Inside a dialog that scrolls, an
  // absolutely positioned list is clipped by the dialog and pushes its scroll
  // height instead of floating over it -- the field ends up in a scrolling
  // strip and whatever follows it disappears below the fold.
  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }

    const place = () => {
      const rect = field.current?.getBoundingClientRect();
      if (!rect) return;

      // Below normally; above when there is not room, so a field near the
      // bottom of the window still shows its options.
      const room = window.innerHeight - rect.bottom;
      const above = room < 200 && rect.top > room;

      setBox({
        left: rect.left,
        width: rect.width,
        ...(above
          ? { bottom: window.innerHeight - rect.top + 2 }
          : { top: rect.bottom + 2 }),
      });
    };

    place();

    // Capture, so a scroll in any ancestor moves the list with its field
    // rather than leaving it hanging in the wrong place.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);

    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const pick = (option: ComboOption) => {
    onChange(option.value);
    setOpen(false);
    setCursor(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      // Down opens the list rather than doing nothing, which is the only
      // discoverable way in for someone who has not clicked the field.
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setTyped(false);
      }
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setCursor((i) => {
        const count = shown.matched.length;
        if (count === 0) return -1;
        return i === -1 ? (step > 0 ? 0 : count - 1) : (i + step + count) % count;
      });
      return;
    }

    // Enter and Escape belong to the list while it is open, or Enter would
    // submit the dialog and Escape would close it out from under a menu the
    // user was only trying to dismiss.
    if (e.key === "Enter" && cursor >= 0) {
      e.preventDefault();
      e.stopPropagation();
      const option = shown.matched[cursor];
      if (option) pick(option);
      return;
    }

    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      setCursor(-1);
    }
  };

  return (
    <div className="combo" ref={field}>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setTyped(true);
          setCursor(-1);
        }}
        onFocus={() => {
          setOpen(true);
          setTyped(false);
        }}
        // A click on an option blurs the input first, so closing waits long
        // enough for that click to land.
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
      />

      {open &&
        box &&
        shown.matched.length > 0 &&
        createPortal(
          <ul className="combo-list" role="listbox" style={box}>
            {shown.matched.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  className={`combo-option ${index === cursor ? "combo-option-cursor" : ""}`}
                  role="option"
                  aria-selected={index === cursor}
                  tabIndex={-1}
                  onMouseEnter={() => setCursor(index)}
                  onMouseDown={() => {
                    window.clearTimeout(blurTimer.current);
                    pick(option);
                  }}
                >
                  <span className="combo-value">{option.value}</span>
                  {option.note && <span className="combo-note">{option.note}</span>}
                </button>
              </li>
            ))}

            {shown.total > shown.matched.length && (
              <li className="combo-more">
                {shown.total - shown.matched.length} more — keep typing
              </li>
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}
