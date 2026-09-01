import { useEffect, useRef, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { Combo, type ComboOption } from "./Combo";

export interface DialogField {
  key: string;
  label: string;
  value?: string;
  placeholder?: string;
  /** Adds a Browse button that opens the native folder picker. */
  browse?: boolean;
  /** Allowed to be submitted empty. */
  optional?: boolean;
  /** Turns the field into a searchable list. A value that matches nothing in
   *  it is still valid — that is how something new gets named. */
  options?: ComboOption[];
  /** A line under the field describing what the current value will do. */
  describe?: (value: string) => string | undefined;
}

export interface DialogCheckbox {
  key: string;
  label: string;
  value?: boolean;
}

export interface DialogSpec {
  title: string;
  message?: string;
  /** Drawn under the message: what the action is about to do. */
  graphic?: ReactNode;
  fields?: DialogField[];
  checkboxes?: DialogCheckbox[];
  confirmLabel: string;
  danger?: boolean;
  /** Checkbox values arrive as the strings "true" and "false". */
  onConfirm: (values: Record<string, string>) => void;
}

/** WebView2 does not implement `window.prompt`, and `confirm` cannot be styled
 *  or keyboard-driven consistently. Everything that needs an answer goes
 *  through this instead. */
export function Dialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of spec.fields ?? []) initial[field.key] = field.value ?? "";
    for (const box of spec.checkboxes ?? []) initial[box.key] = String(box.value ?? false);
    return initial;
  });

  const firstInput = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    firstInput.current?.select();

    // A dialog with no text field has nothing that autofocuses, and the key
    // handling below lives on this element -- without focus inside it, Escape
    // and Enter never arrive and the dialog can only be finished with a mouse.
    if (!firstInput.current) frame.current?.focus();
  }, []);

  /** Everything inside that can hold focus, in tab order. */
  const focusable = () =>
    Array.from(
      frame.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }

    // Tab cycles within the dialog. Without this it walks straight out into the
    // window behind the scrim, where the highlight vanishes and every key does
    // something to a repository the user cannot see.
    if (e.key === "Tab") {
      const stops = focusable();
      if (stops.length === 0) return;

      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const here = document.activeElement;

      if (e.shiftKey && (here === first || here === frame.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    if (e.key === "Enter") {
      // A focused button already acts on Enter. Confirming here as well would
      // run Cancel and the confirm from one keystroke -- on a delete dialog,
      // pressing Enter on Cancel would delete the branch.
      if (e.target instanceof HTMLButtonElement) return;

      e.preventDefault();
      confirm();
    }
  };

  const missing = (spec.fields ?? []).some(
    (field) => !field.optional && values[field.key]?.trim() === "",
  );

  const confirm = () => {
    if (missing) return;

    const trimmed: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) trimmed[key] = value.trim();

    spec.onConfirm(trimmed);
    onClose();
  };

  const browse = async (key: string) => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") {
      setValues((v) => ({ ...v, [key]: picked }));
    }
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="dialog"
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className="dialog-title">{spec.title}</h2>
        {spec.message && <p className="dialog-message">{spec.message}</p>}
        {spec.graphic}

        {spec.fields?.map((field, index) => (
          <label className="dialog-field" key={field.key}>
            <span>{field.label}</span>
            <div className="dialog-input-row">
              {field.options ? (
                <Combo
                  inputRef={index === 0 ? firstInput : undefined}
                  autoFocus={index === 0}
                  value={values[field.key] ?? ""}
                  options={field.options}
                  placeholder={field.placeholder}
                  onChange={(next) => setValues((v) => ({ ...v, [field.key]: next }))}
                />
              ) : (
                <input
                  ref={index === 0 ? firstInput : undefined}
                  autoFocus={index === 0}
                  value={values[field.key] ?? ""}
                  placeholder={field.placeholder}
                  spellCheck={false}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                />
              )}
              {field.browse && (
                <button className="btn" onClick={() => void browse(field.key)}>
                  Browse
                </button>
              )}
            </div>
            {field.describe?.(values[field.key] ?? "") && (
              <span className="dialog-describe">
                {field.describe(values[field.key] ?? "")}
              </span>
            )}
          </label>
        ))}

        {spec.checkboxes?.map((box) => (
          <label className="dialog-check" key={box.key}>
            <input
              type="checkbox"
              checked={values[box.key] === "true"}
              onChange={(e) =>
                setValues((v) => ({ ...v, [box.key]: String(e.target.checked) }))
              }
            />
            {box.label}
          </label>
        ))}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={spec.danger ? "btn-danger" : "btn-primary"}
            disabled={missing}
            autoFocus={!spec.fields?.length}
            onClick={confirm}
          >
            {spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
