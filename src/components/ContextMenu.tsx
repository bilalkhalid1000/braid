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
const MENU =
  "fixed min-w-[200px] p-2 bg-chrome border border-border rounded-lg shadow-pop-lg";

/* `group` so the key cap can follow the row it sits in: on a highlighted row
   the cap has to lift off the accent behind it, and it cannot ask about its
   parent's hover on its own. */
const ITEM =
  "group flex w-full items-center gap-8 px-4 py-[5px] bg-transparent border-0 rounded-sm " +
  "text-body text-left whitespace-nowrap cursor-pointer " +
  "disabled:text-text-faint disabled:cursor-default";

const PLAIN = "enabled:hover:bg-accent enabled:hover:text-white";
const DANGER = "text-removed enabled:hover:bg-removed enabled:hover:text-white";

/** The key cap, lifted onto a coloured row. */
const ON_ACCENT = "bg-white/[0.18] border-white/35 text-white";
const HINT =
  "group-enabled:group-hover:bg-white/[0.18] group-enabled:group-hover:border-white/35 " +
  "group-enabled:group-hover:text-white";

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
    <div
      className="fixed inset-0 z-20"
      onMouseDown={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className={MENU}
        ref={ref}
        style={position}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {state.entries.map((entry, at) =>
          entry === "separator" ? (
            <div className="mx-2 my-2 h-px bg-border-soft" key={`sep-${at}`} />
          ) : (
            <button
              key={entry.label}
              className={[
                ITEM,
                entry.danger ? DANGER : PLAIN,
                // The keyboard cursor wears what hovering would give it. It
                // never lands on a disabled entry, so there is no state where
                // this and :disabled both apply.
                at === cursor && (entry.danger ? "bg-removed text-white" : "bg-accent text-white"),
              ]
                .filter(Boolean)
                .join(" ")}
              role="menuitem"
              tabIndex={-1}
              disabled={entry.disabled}
              // Hovering moves the cursor too, so the mouse and the keyboard
              // never disagree about which entry is selected.
              onMouseEnter={() => setIndex(items.findIndex((row) => row.at === at))}
              onClick={() => run(entry)}
            >
              <span className="flex-1">{entry.label}</span>
              {entry.hint && (
                <kbd className={`${HINT} ${at === cursor ? ON_ACCENT : ""}`}>{entry.hint}</kbd>
              )}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
