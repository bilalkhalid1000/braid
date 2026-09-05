import { useEffect, useMemo, useRef, useState } from "react";
import { COMMANDS, type CommandDef } from "../lib/commands";
import { formatBinding } from "../lib/shortcutLabel";
import { useSettings } from "../lib/settings";
import { matchesFilter } from "./FilterInput";
import { SCRIM_TOP } from "../lib/overlay";

interface Props {
  /** Which commands are runnable right now, and how to run them. */
  handlers: Record<string, (() => void) | undefined>;
  /** The user's own commands, listed beside the catalog's. */
  custom?: CommandDef[];
  onClose: () => void;
}

/** Every action in the app, searchable, with its key shown beside it.
 *
 *  Doubles as the way to discover shortcuts: the palette is where you find out
 *  a command exists, and the key next to it is how you stop needing the
 *  palette. */
const FRAME =
  "grid grid-rows-[auto_minmax(0,1fr)] w-[min(620px,92vw)] max-h-[60vh] overflow-hidden " +
  "bg-chrome border border-border rounded-lg shadow-pop-lg";

const INPUT =
  "p-6 bg-transparent border-0 border-b border-b-border text-lead outline-none";

const ROW =
  "grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 " +
  "rounded-sm cursor-default";

/* Uppercased and spaced out: it is a label on the row rather than part of what
   the row says. */
const CATEGORY =
  "overflow-hidden text-ellipsis whitespace-nowrap uppercase tracking-[0.06em] " +
  "text-micro text-text-faint";

export function CommandPalette({ handlers, onClose, custom }: Props) {
  const { keymap } = useSettings();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const available = useMemo(
    () => [...COMMANDS, ...(custom ?? [])].filter((command) => handlers[command.id]),
    [handlers, custom],
  );

  const matches = useMemo(
    () =>
      available.filter(
        (command) =>
          matchesFilter(command.label, query) || matchesFilter(command.category, query),
      ),
    [available, query],
  );

  // Reset the cursor whenever the result set changes under it.
  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const run = (command: CommandDef) => {
    onClose();
    // After the close, so a command that opens a dialog is not immediately
    // covered by the palette unmounting around it.
    handlers[command.id]?.();
  };

  return (
    <div className={SCRIM_TOP} onMouseDown={onClose}>
      <div className={FRAME} onMouseDown={(e) => e.stopPropagation()}>
        <input
          className={INPUT}
          autoFocus
          value={query}
          placeholder="Type a command"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, matches.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && matches[selected]) {
              e.preventDefault();
              run(matches[selected]);
            }
          }}
        />

        <div className="overflow-y-auto p-2" ref={listRef}>
          {matches.map((command, index) => {
            const bindings = keymap[command.id] ?? [];

            return (
              <div
                key={command.id}
                data-index={index}
                className={`${ROW} ${index === selected ? "bg-select" : ""}`}
                onMouseMove={() => setSelected(index)}
                onMouseDown={() => run(command)}
              >
                <span className={CATEGORY}>{command.category}</span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{command.label}</span>

                <span className="flex gap-2">
                  {bindings.map((binding) => (
                    <kbd key={binding}>{formatBinding(binding)}</kbd>
                  ))}
                </span>
              </div>
            );
          })}

          {matches.length === 0 && (
            <div className="p-8 text-center text-text-faint">
              {available.length === 0
                ? "Open a repository to get started."
                : "No command matches that."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
