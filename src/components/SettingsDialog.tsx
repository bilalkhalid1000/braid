import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkeyRecorder } from "@tanstack/react-hotkeys";

import { COMMANDS, COMMANDS_BY_ID, findConflicts, type CommandDef } from "../lib/commands";
import { formatBinding } from "../lib/shortcutLabel";
import { useSettings, type Settings } from "../lib/settings";
import { FilterInput, matchesFilter } from "./FilterInput";

type Section = "general" | "diff" | "shortcuts" | "about";

/** Numbered because the number is the key that gets you here, the same way the
 *  sidebar panels are numbered. Nothing here is a sequence, so the digits are
 *  not implying an order — they are the shortcut, printed. */
const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: "general", label: "General", blurb: "Appearance and what happens at launch" },
  { id: "diff", label: "Diff", blurb: "How changes are shown" },
  { id: "shortcuts", label: "Shortcuts", blurb: "Every key, and how to change it" },
  { id: "about", label: "About", blurb: "Where things are kept" },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>("general");
  const frame = useRef<HTMLDivElement>(null);

  // The dialog owns the keyboard while it is open: the app's own commands are
  // suspended, so digits here are unambiguous.
  useEffect(() => frame.current?.focus(), []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }

    // Never steal a keystroke meant for a field.
    const typing =
      e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if (typing && e.key !== "Escape") return;

    const digit = Number(e.key);
    if (digit >= 1 && digit <= SECTIONS.length) {
      e.preventDefault();
      setSection(SECTIONS[digit - 1].id);
      return;
    }

    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step !== 0) {
      e.preventDefault();
      const index = SECTIONS.findIndex((s) => s.id === section);
      const next = Math.min(Math.max(index + step, 0), SECTIONS.length - 1);
      setSection(SECTIONS[next].id);
    }
  };

  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="settings"
        ref={frame}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <nav className="settings-nav">
          <h2 className="settings-title">Settings</h2>

          {SECTIONS.map((item, index) => (
            <button
              key={item.id}
              className={`settings-tab ${section === item.id ? "settings-tab-active" : ""}`}
              onClick={() => setSection(item.id)}
            >
              <kbd className="settings-tab-key">{index + 1}</kbd>
              <span>{item.label}</span>
            </button>
          ))}

          <p className="settings-nav-hint">
            <kbd>1</kbd>–<kbd>{SECTIONS.length}</kbd> jump · <kbd>↑</kbd>
            <kbd>↓</kbd> move · <kbd>Esc</kbd> close
          </p>
        </nav>

        <div className="settings-body">
          <header className="settings-header">
            <h3 className="settings-heading">{current.label}</h3>
            <p className="settings-blurb">{current.blurb}</p>
          </header>

          {section === "general" && <GeneralSection />}
          {section === "diff" && <DiffSection />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "about" && <AboutSection />}
        </div>

        <button className="settings-close" title="Close settings" onClick={onClose}>
          &times;
        </button>
      </div>
    </div>
  );
}

function GeneralSection() {
  const { settings, update } = useSettings();

  return (
    <>
      <Field label="Theme" hint="System follows Windows and changes with it while the app is open.">
        <select
          value={settings.theme}
          onChange={(e) => update({ theme: e.target.value as Settings["theme"] })}
        >
          <option value="system">Follow the system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>

      <Toggle
        label="Reopen repositories on launch"
        hint="Restores the tabs that were open when you last closed the app."
        value={settings.restoreTabs}
        onChange={(restoreTabs) => update({ restoreTabs })}
      />

      <Toggle
        label="Ask before discarding changes"
        hint="Discarding cannot be undone; git keeps no record of it."
        value={settings.confirmDiscard}
        onChange={(confirmDiscard) => update({ confirmDiscard })}
      />

      <Field label="History page size" hint="Commits loaded at a time as you scroll.">
        <input
          type="number"
          min={50}
          max={2000}
          step={50}
          value={settings.historyPageSize}
          onChange={(e) => update({ historyPageSize: clamp(Number(e.target.value), 50, 2000) })}
        />
      </Field>

      <Field
        label="Sequence timeout"
        hint="How long a two-key shortcut like G F waits for its second key, in milliseconds."
      >
        <input
          type="number"
          min={200}
          max={3000}
          step={100}
          value={settings.sequenceTimeout}
          onChange={(e) => update({ sequenceTimeout: clamp(Number(e.target.value), 200, 3000) })}
        />
      </Field>
    </>
  );
}

function DiffSection() {
  const { settings, update } = useSettings();

  return (
    <>
      <Field
        label="Context lines"
        hint="Unchanged lines shown around each change. Git's own default is 3."
      >
        <input
          type="number"
          min={0}
          max={50}
          value={settings.diffContextLines}
          onChange={(e) => update({ diffContextLines: clamp(Number(e.target.value), 0, 50) })}
        />
      </Field>

      <Toggle
        label="Ignore whitespace"
        hint="Hides lines that differ only in spacing. Useful after a reformat, misleading in a language where indentation is syntax."
        value={settings.ignoreWhitespace}
        onChange={(ignoreWhitespace) => update({ ignoreWhitespace })}
      />
    </>
  );
}

function ShortcutsSection() {
  const { settings, keymap, update } = useSettings();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const conflicts = useMemo(() => findConflicts(keymap), [keymap]);

  /** commandId to the other commands fighting it for the same key. */
  const rivals = useMemo(() => {
    const map = new Map<string, string[]>();

    for (const conflict of conflicts) {
      for (const id of conflict.commandIds) {
        map.set(
          id,
          conflict.commandIds.filter((other) => other !== id),
        );
      }
    }

    return map;
  }, [conflicts]);

  const shown = COMMANDS.filter(
    (command) =>
      matchesFilter(command.label, filter) ||
      matchesFilter(command.category, filter) ||
      (keymap[command.id] ?? []).some((binding) => matchesFilter(binding, filter)),
  );

  const groups = new Map<string, CommandDef[]>();
  for (const command of shown) {
    groups.set(command.category, [...(groups.get(command.category) ?? []), command]);
  }

  const changedCount = Object.keys(settings.keymap).length;

  const setBindings = (id: string, bindings: string[]) =>
    update({ keymap: { ...settings.keymap, [id]: bindings } });

  const resetBinding = (id: string) => {
    const next = { ...settings.keymap };
    delete next[id];
    update({ keymap: next });
  };

  return (
    <>
      <div className="settings-toolbar">
        <FilterInput
          value={filter}
          onChange={setFilter}
          placeholder="Filter commands"
          matches={shown.length}
        />
        <button
          className="btn"
          disabled={changedCount === 0}
          title="Put every shortcut back to what it ships with"
          onClick={() => update({ keymap: {} })}
        >
          Reset all{changedCount > 0 && ` (${changedCount})`}
        </button>
      </div>

      <p className="settings-note settings-note-tight">
        Click a key to record a new one. Escape cancels, Backspace clears.
      </p>

      {conflicts.length > 0 && (
        <p className="settings-warning">
          {conflicts.length === 1 ? "One key is" : `${conflicts.length} keys are`} bound twice
          in a way that can collide. Whichever was registered last wins.
        </p>
      )}

      {[...groups].map(([category, commands]) => (
        <section key={category} className="shortcut-group">
          <h4 className="shortcut-heading">{category}</h4>

          {commands.map((command) => (
            <ShortcutRow
              key={command.id}
              command={command}
              bindings={keymap[command.id] ?? []}
              changed={command.id in settings.keymap}
              rivals={rivals.get(command.id) ?? []}
              editing={editing}
              onEditing={setEditing}
              onSet={(bindings) => setBindings(command.id, bindings)}
              onReset={() => resetBinding(command.id)}
            />
          ))}
        </section>
      ))}

      {shown.length === 0 && (
        <p className="settings-empty">
          No command matches that. Try a category, like “git” or “panels”.
        </p>
      )}
    </>
  );
}

function ShortcutRow({
  command,
  bindings,
  changed,
  rivals,
  editing,
  onEditing,
  onSet,
  onReset,
}: {
  command: CommandDef;
  bindings: string[];
  changed: boolean;
  rivals: string[];
  /** Which slot is recording: "<commandId>:<index>", or null. */
  editing: string | null;
  onEditing: (slot: string | null) => void;
  onSet: (bindings: string[]) => void;
  onReset: () => void;
}) {
  const slot = (index: number) => `${command.id}:${index}`;
  const recordingIndex = bindings.findIndex((_, i) => editing === slot(i));
  const addingNew = editing === `${command.id}:new`;

  const replace = (index: number, binding: string) =>
    onSet(bindings.map((existing, i) => (i === index ? binding : existing)));

  const remove = (index: number) => onSet(bindings.filter((_, i) => i !== index));

  return (
    <div className={`shortcut-row ${rivals.length > 0 ? "shortcut-row-conflict" : ""}`}>
      <span className="shortcut-label">
        {command.label}
        {changed && <span className="shortcut-changed" title="Changed from the default" />}
      </span>

      <span className="shortcut-keys">
        {bindings.map((binding, index) => (
          <KeySlot
            key={`${binding}-${index}`}
            binding={binding}
            recording={recordingIndex === index}
            onStart={() => onEditing(slot(index))}
            onDone={() => onEditing(null)}
            onSet={(next) => replace(index, next)}
            onRemove={() => remove(index)}
          />
        ))}

        {addingNew ? (
          <KeySlot
            binding=""
            recording
            onStart={() => {}}
            onDone={() => onEditing(null)}
            onSet={(next) => onSet([...bindings, next])}
            onRemove={() => onEditing(null)}
          />
        ) : (
          <button
            className="shortcut-add"
            title="Add another key for this command"
            onClick={() => onEditing(`${command.id}:new`)}
          >
            +
          </button>
        )}

        {bindings.length === 0 && !addingNew && (
          <span className="shortcut-unbound">not bound</span>
        )}
      </span>

      <button className="link-button hover-only" disabled={!changed} onClick={onReset}>
        reset
      </button>

      {rivals.length > 0 && (
        <span className="shortcut-conflict">
          also {rivals.map((id) => COMMANDS_BY_ID[id]?.label ?? id).join(", ")}
        </span>
      )}
    </div>
  );
}

/** One key on a command. Clicking it records a replacement; the cross removes
 *  it. A command with no slots left is simply unbound. */
function KeySlot({
  binding,
  recording,
  onStart,
  onDone,
  onSet,
  onRemove,
}: {
  binding: string;
  recording: boolean;
  onStart: () => void;
  onDone: () => void;
  onSet: (binding: string) => void;
  onRemove: () => void;
}) {
  const recorder = useHotkeyRecorder({
    onRecord: (hotkey) => {
      onSet(hotkey);
      onDone();
    },
    onCancel: onDone,
  });

  // The recorder only listens once started, so a slot that mounts already in
  // recording state has to start it.
  useEffect(() => {
    if (recording && !recorder.isRecording) recorder.startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  if (recording) {
    return (
      <button className="shortcut-key shortcut-key-recording" onClick={recorder.cancelRecording}>
        {recorder.recordedHotkey ? formatBinding(recorder.recordedHotkey) : "Press a key…"}
      </button>
    );
  }

  return (
    <span className="shortcut-slot">
      <button
        className="shortcut-key"
        title="Click to record a different key"
        onClick={onStart}
      >
        <kbd>{formatBinding(binding)}</kbd>
      </button>
      <button className="shortcut-remove hover-only" title="Remove this key" onClick={onRemove}>
        &times;
      </button>
    </span>
  );
}

function AboutSection() {
  return (
    <>
      <Field label="Braid" hint="A fast, keyboard-first Git client.">
        <span className="settings-static">0.1.0</span>
      </Field>

      <p className="settings-note">
        Settings, shortcuts and the list of open repositories are stored as JSON beside the
        app's own config, so they can be read, edited or deleted by hand.
      </p>

      <p className="settings-note">
        Writes go through your own <span className="mono">git</span>, so hooks, credential
        helpers, signing and LFS behave exactly as they do in your terminal. Braid never asks
        for a password itself.
      </p>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Field>
  );
}

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min;
