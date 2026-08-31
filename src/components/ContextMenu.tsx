import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { useCommands } from "../lib/useCommands";

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
 *  hides its own features.
 *
 *  Navigation goes through the command catalog like every other list in the
 *  app, so the keys are the ones the user chose. A menu raised by a shortcut
 *  that could then only be finished with the mouse would be worse than no
 *  shortcut at all.
 */
export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });
  const [index, setIndex] = useState(-1);

  // Separators and disabled entries are not stops, so the cursor walks the
  // items that can actually run.
  const items = useMemo(
    () =>
      state.entries
        .map((entry, at) => ({ entry, at }))
        .filter(
          (row): row is { entry: MenuItem; at: number } =>
            row.entry !== "separator" && !row.entry.disabled,
        ),
    [state.entries],
  );

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

  const move = (step: number) => {
    if (items.length === 0) return;
    // Nothing selected yet: down starts at the top, up at the bottom.
    setIndex((i) =>
      i === -1
        ? step > 0
          ? 0
          : items.length - 1
        : (i + step + items.length) % items.length,
    );
  };

  const run = (item: MenuItem) => {
    item.onClick();
    onClose();
  };

  useCommands({
    "menu.next": () => move(1),
    "menu.previous": () => move(-1),
    // Nothing starts selected, so Enter cannot fire an entry that merely
    // happened to be first -- which matters when that entry is destructive.
    "menu.activate": () => {
      const item = items[index];
      if (item) run(item.entry);
    },
    "menu.close": onClose,
  });

  const cursor = items[index]?.at;

  return (
    <div className="menu-scrim" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="menu"
        ref={ref}
        style={position}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {state.entries.map((entry, at) =>
          entry === "separator" ? (
            <div className="menu-separator" key={`sep-${at}`} />
          ) : (
            <button
              key={entry.label}
              className={`menu-item ${entry.danger ? "menu-item-danger" : ""} ${
                at === cursor ? "menu-item-cursor" : ""
              }`}
              role="menuitem"
              tabIndex={-1}
              disabled={entry.disabled}
              // Hovering moves the cursor too, so the mouse and the keyboard
              // never disagree about which entry is selected.
              onMouseEnter={() => setIndex(items.findIndex((row) => row.at === at))}
              onClick={() => run(entry)}
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
