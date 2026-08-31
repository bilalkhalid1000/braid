import { useMemo, useRef, useState } from "react";

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
  const blurTimer = useRef(0);

  const shown = useMemo(() => {
    const matched = options.filter((option) => matchesFilter(option.value, value));
    return { matched: matched.slice(0, MAX_SHOWN), total: matched.length };
  }, [options, value]);

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
    <div className="combo">
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
          setCursor(-1);
        }}
        onFocus={() => setOpen(true)}
        // A click on an option blurs the input first, so closing waits long
        // enough for that click to land.
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
      />

      {open && shown.matched.length > 0 && (
        <ul className="combo-list" role="listbox">
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
        </ul>
      )}
    </div>
  );
}
