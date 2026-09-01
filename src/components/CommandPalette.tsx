import { useEffect, useMemo, useRef, useState } from "react";
import { COMMANDS, type CommandDef } from "../lib/commands";
import { formatBinding } from "../lib/shortcutLabel";
import { useSettings } from "../lib/settings";
import { matchesFilter } from "./FilterInput";
import { SCRIM_TOP } from "../lib/overlay";

interface Props {
  /** Which commands are runnable right now, and how to run them. */
  handlers: Record<string, (() => void) | undefined>;
  onClose: () => void;
}

/** Every action in the app, searchable, with its key shown beside it.
 *
 *  Doubles as the way to discover shortcuts: the palette is where you find out
 *  a command exists, and the key next to it is how you stop needing the
 *  palette. */
export function CommandPalette({ handlers, onClose }: Props) {
  const { keymap } = useSettings();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const available = useMemo(
    () => COMMANDS.filter((command) => handlers[command.id]),
    [handlers],
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
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
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

        <div className="palette-list" ref={listRef}>
          {matches.map((command, index) => {
            const bindings = keymap[command.id] ?? [];

            return (
              <div
                key={command.id}
                data-index={index}
                className={`palette-row ${index === selected ? "palette-row-selected" : ""}`}
                onMouseMove={() => setSelected(index)}
                onMouseDown={() => run(command)}
              >
                <span className="palette-category">{command.category}</span>
                <span className="palette-label">{command.label}</span>

                <span className="palette-keys">
                  {bindings.map((binding) => (
                    <kbd key={binding}>{formatBinding(binding)}</kbd>
                  ))}
                </span>
              </div>
            );
          })}

          {matches.length === 0 && (
            <div className="palette-empty">
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
