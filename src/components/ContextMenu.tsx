import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Key shown on the right, for entries that also have a shortcut. */
  hint?: string;
}

export type MenuEntry = MenuItem | "separator";

export interface MenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

/** Right-click menu.
 *
 *  Every destructive or non-obvious repository action is reachable from here,
 *  because a GUI whose only path to "checkout" is a double-click is a GUI that
 *  hides its own features. */
export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });

  // Flip the menu back inside the window when opened near an edge, measuring
  // after layout so the real height is known.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: Math.min(state.x, window.innerWidth - width - 4),
      top: Math.min(state.y, window.innerHeight - height - 4),
    });
  }, [state.x, state.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="menu-scrim" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="menu"
        ref={ref}
        style={position}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {state.entries.map((entry, index) =>
          entry === "separator" ? (
            <div className="menu-separator" key={`sep-${index}`} />
          ) : (
            <button
              key={entry.label}
              className={`menu-item ${entry.danger ? "menu-item-danger" : ""}`}
              disabled={entry.disabled}
              onClick={() => {
                entry.onClick();
                onClose();
              }}
            >
              <span className="menu-label">{entry.label}</span>
              {entry.hint && <kbd className="menu-hint">{entry.hint}</kbd>}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
