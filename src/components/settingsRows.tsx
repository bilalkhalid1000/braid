import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";

/** One line in a settings section.
 *
 *  A row describes what it is worth doing to it rather than what keys do it, so
 *  the dialog can bind those keys once instead of every section inventing its
 *  own. */
export interface Row {
  key: string;
  label: string;
  hint?: ReactNode;
  control: ReactNode;
  /** Left and right. A step for a number, the next option for a select, on or
   *  off for a toggle. */
  adjust?: (delta: number) => void;
  /** Enter. Absent for rows that only answer to left and right. */
  activate?: () => void;
  /** Enter puts the caret in it rather than doing something to it. */
  editable?: boolean;
}

interface Cursor {
  index: number;
  setIndex: (index: number) => void;
  /** Called after every render so the dialog's keys act on what is on screen. */
  register: (rows: Row[], focus: (key: string) => void) => void;
}

const CursorContext = createContext<Cursor | null>(null);

export const SettingsCursor = CursorContext.Provider;

export function useSettingsCursor() {
  return useContext(CursorContext);
}

/* The whole point of the cursor: something has to show where it is. Selection
   rather than focus, because the keys are handled by the dialog and the browser
   is not moving focus at all -- so the browser draws nothing. */
const ROW = "flex items-start gap-12 border-b border-b-border-soft px-3 py-6 -mx-3 rounded-sm";
const ROW_AT = "bg-select";

export function SettingsRows({ rows }: { rows: Row[] }) {
  const cursor = useSettingsCursor();
  const controls = useRef(new Map<string, HTMLElement>());

  const focus = (key: string) => {
    const element = controls.current.get(key);
    element?.focus();
    if (element instanceof HTMLInputElement) element.select();
  };

  // After every render, not on a dependency list: the rows are rebuilt from
  // settings each time, and a stale list would act on the value before the one
  // being looked at.
  useEffect(() => {
    cursor?.register(rows, focus);
  });

  return (
    <>
      {rows.map((row, index) => (
        <SettingRow
          key={row.key}
          row={row}
          // Only where there is something to do. A highlight on a line that
          // answers nothing reads as the keyboard having stopped working.
          at={cursor?.index === index && Boolean(row.adjust || row.activate || row.editable)}
          onPoint={() => cursor?.setIndex(index)}
          hold={(element) => {
            if (element) controls.current.set(row.key, element);
            else controls.current.delete(row.key);
          }}
        />
      ))}
    </>
  );
}

function SettingRow({
  row,
  at,
  onPoint,
  hold,
}: {
  row: Row;
  at: boolean;
  onPoint: () => void;
  hold: (element: HTMLElement | null) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;

  // The label and the control are in separate columns for layout, so they are
  // tied together by id rather than by nesting. Without it a checkbox is
  // announced as just "checkbox", and clicking the words does nothing.
  const control = isValidElement(row.control)
    ? cloneElement(row.control as ReactElement<Record<string, unknown>>, {
        id,
        ref: hold,
        "aria-describedby": row.hint ? hintId : undefined,
      })
    : row.control;

  return (
    // Focus moves the cursor, so there is only ever one notion of which row is
    // current. Clicking a control or tabbing to it used to move the focus and
    // leave the cursor where it was, and then an arrow key changed a different
    // row while the control's own handling was suppressed -- so the setting
    // being looked at never moved.
    <div
      className={`${ROW} ${at ? ROW_AT : ""}`}
      onMouseEnter={onPoint}
      onFocusCapture={onPoint}
    >
      <div className="grid min-w-0 flex-1 gap-1">
        <label className="w-fit cursor-pointer font-semibold" htmlFor={id}>
          {row.label}
        </label>
        {row.hint && (
          <span className="text-small leading-[1.5] text-text-dim" id={hintId}>
            {row.hint}
          </span>
        )}
      </div>

      <div className="flex-none pt-1">{control}</div>
    </div>
  );
}

/* --- builders ---------------------------------------------------------- */

const FIELD =
  "rounded-sm border border-border bg-surface px-3 py-1 text-body " +
  "focus-visible:outline-2 focus-visible:outline-accent";

export function toggleRow(
  key: string,
  label: string,
  hint: string,
  value: boolean,
  onChange: (value: boolean) => void,
): Row {
  return {
    key,
    label,
    hint,
    activate: () => onChange(!value),
    // Left is off and right is on, rather than both toggling: holding a
    // direction should not flip it back and forth.
    adjust: (delta) => onChange(delta > 0),
    control: (
      <input
        type="checkbox"
        className="accent-accent"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    ),
  };
}

export function selectRow(
  key: string,
  label: string,
  hint: ReactNode,
  value: string,
  options: { value: string; label: string }[],
  onChange: (value: string) => void,
): Row {
  const step = (delta: number) => {
    const at = options.findIndex((option) => option.value === value);
    // Clamped, not wrapped. Holding right should stop at the last option
    // rather than cycling past it back to the first.
    const next = Math.min(Math.max(at + delta, 0), options.length - 1);
    if (options[next]) onChange(options[next].value);
  };

  return {
    key,
    label,
    hint,
    adjust: step,
    control: (
      <select className={FIELD} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
}

export function numberRow(
  key: string,
  label: string,
  hint: string,
  value: number,
  bounds: { min: number; max: number; step: number },
  onChange: (value: number) => void,
): Row {
  const clamp = (next: number) => Math.min(Math.max(next, bounds.min), bounds.max);

  return {
    key,
    label,
    hint,
    editable: true,
    adjust: (delta) => onChange(clamp(value + delta * bounds.step)),
    control: (
      <input
        type="number"
        className={`${FIELD} w-24 text-right`}
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
      />
    ),
  };
}

export function textRow(
  key: string,
  label: string,
  hint: ReactNode,
  value: string,
  placeholder: string,
  onChange: (value: string) => void,
): Row {
  return {
    key,
    label,
    hint,
    editable: true,
    control: (
      <input
        type="text"
        className={`${FIELD} w-[280px]`}
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    ),
  };
}

export function actionRow(
  key: string,
  label: string,
  hint: ReactNode,
  button: { label: string; disabled?: boolean; primary?: boolean; onPress: () => void },
): Row {
  return {
    key,
    label,
    hint,
    activate: () => {
      if (!button.disabled) button.onPress();
    },
    control: (
      <button
        className={button.primary ? "btn-primary" : "btn"}
        disabled={button.disabled}
        onClick={button.onPress}
      >
        {button.label}
      </button>
    ),
  };
}

/** Something to read, with nothing to do to it. Still a row, so it lines up
 *  with the ones above it; never a cursor stop, because stopping somewhere
 *  that answers no key is how a keyboard interface feels broken. */
export function staticRow(key: string, label: string, hint: ReactNode, value: ReactNode): Row {
  return { key, label, hint, control: value };
}
