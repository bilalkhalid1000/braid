import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useHotkeyRecorder } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";

import { api, type TerminalOption } from "../lib/api";
import { nextStop, settingsAction } from "../lib/settingsKeys";
import {
  SettingsCursor,
  SettingsRows,
  useSettingsCursor,
  actionRow,
  numberRow,
  selectRow,
  staticRow,
  textRow,
  toggleRow,
  type Row,
} from "./settingsRows";

import { COMMANDS, COMMANDS_BY_ID, findConflicts, type CommandDef } from "../lib/commands";
import { formatBinding } from "../lib/shortcutLabel";
import { useSettings, type Settings } from "../lib/settings";
import { useUpdater } from "../lib/useUpdater";
import { useAppVersion } from "../lib/useAppVersion";
import { channelCaution, channelLabel } from "../lib/version";
import { FilterInput, matchesFilter } from "./FilterInput";
import { Keys } from "./Keys";
import { SCRIM } from "../lib/overlay";
import { useTip } from "./Tip";

type Section = "general" | "diff" | "shortcuts" | "commands" | "updates" | "about";

/** Numbered because the number is the key that gets you here, the same way the
 *  sidebar panels are numbered. Nothing here is a sequence, so the digits are
 *  not implying an order — they are the shortcut, printed. */
const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: "general", label: "General", blurb: "Appearance and what happens at launch" },
  { id: "diff", label: "Diff", blurb: "How changes are shown" },
  { id: "shortcuts", label: "Shortcuts", blurb: "Every key, and how to change it" },
  { id: "commands", label: "Commands", blurb: "Your own, from the settings file" },
  { id: "updates", label: "Updates", blurb: "New versions, and when to look for them" },
  { id: "about", label: "About", blurb: "Where things are kept" },
];

/* Everything the browser will move focus to with Tab. Disabled controls are
   excluded because Tab skips them, and a trap that counts them would stop on
   nothing. */
/** A box with a caret in it, which owns every key while it has the keyboard.
 *
 *  A select is deliberately not one. It can hold the focus after a click, and
 *  if it answered the arrows as well then the same key would do two different
 *  things depending on whether you last used the mouse -- which is exactly how
 *  the arrows stopped working on the selects. */
function isEditing(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;

  return ["text", "number", "search", "password", "email", "url"].includes(target.type);
}

const FRAME =
  "relative grid grid-cols-[208px_minmax(0,1fr)] w-[min(880px,92vw)] h-[min(640px,88vh)] " +
  "overflow-hidden bg-chrome border border-border rounded-lg shadow-pop-lg outline-none";

const NAV =
  "flex flex-col gap-1 px-4 pt-8 pb-4 bg-chrome-alt border-r border-r-border";

const TITLE = "mt-0 mr-0 mb-6 ml-3 text-lead font-semibold tracking-[-0.01em]";

const TAB =
  "flex items-center gap-4 p-3 bg-transparent border-0 border-l-2 " +
  "rounded-r-sm text-left cursor-pointer";

const NAV_HINT =
  "mt-auto text-micro leading-[2] text-text-faint [&_kbd]:mx-px";

const CLOSE =
  "absolute top-4 right-6 bg-transparent border-0 text-[18px] leading-none " +
  "text-text-faint cursor-pointer hover:text-text";

const NOTE = "mt-6 mb-0 text-small leading-[1.55] text-text-dim";
const NOTE_TIGHT = "mt-0 mb-6 text-small leading-[1.55] text-text-dim";

const WARNING =
  "mt-0 mb-6 px-4 py-3 bg-modified-bg border-l-[3px] border-l-modified rounded-sm " +
  "text-small leading-[1.5]";

const GROUP_HEADING =
  "mt-0 mb-2 uppercase tracking-[0.09em] text-micro font-semibold text-text-dim";

/* `group` so a row can reveal its own reset link on hover or focus. */
const ROW =
  "group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 " +
  "pt-2 pr-3 pb-2 pl-0 border-b border-b-border-soft " +
  "[&:hover_.hover-only]:opacity-100 [&:focus-within_.hover-only]:opacity-100";

const LABEL =
  "flex items-center gap-3 overflow-hidden text-ellipsis whitespace-nowrap";

/* A fixed floor so the keys line up as a column instead of stepping in and out
   with the width of what is bound. */
const KEYS = "flex min-w-[150px] items-center justify-end gap-3";

const KEY =
  "inline-flex items-center gap-2 p-[2px] bg-transparent border border-transparent " +
  "rounded-sm cursor-pointer hover:border-border";

const RECORDING =
  "px-3 py-[2px] bg-accent-soft border-accent text-small text-accent whitespace-nowrap";

const REMOVE =
  "ml-px px-[2px] bg-transparent border-0 text-body leading-none text-text-faint " +
  "cursor-pointer hover:text-removed";

/* Dashed until it holds something: it is a slot rather than a key. */
const ADD =
  "px-3 bg-transparent border border-dashed border-border rounded-sm text-body " +
  "leading-4 text-text-faint cursor-pointer hover:border-solid hover:border-accent hover:text-accent";

const CONFLICT = "col-span-full pb-2 text-micro text-modified";

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), ' +
  'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function SettingsDialog({
  onClose,
  initialSection = "general",
}: {
  onClose: () => void;
  /** Which section to open on. "?" asks about keys, so it opens on them. */
  initialSection?: Section;
}) {
  const [section, setSection] = useState<Section>(initialSection);
  const tip = useTip();
  const [cursor, setCursor] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // What the section currently on screen put up, and how to put the caret in
  // one of them. Kept in a ref rather than state because it is rewritten on
  // every render and reading it is the only thing anybody does.
  const rows = useRef<Row[]>([]);
  const focusRow = useRef<(key: string) => void>(() => {});

  const register = useCallback((next: Row[], focus: (key: string) => void) => {
    rows.current = next;
    focusRow.current = focus;
  }, []);

  // The dialog owns the keyboard while it is open: the app's own commands are
  // suspended, so digits here are unambiguous.
  useEffect(() => frame.current?.focus(), []);

  /** Rows worth stopping on. A row with nothing to do to it is skipped rather
   *  than selected, because a cursor sitting somewhere that answers no key is
   *  how a keyboard interface starts feeling broken. */
  const stops = () =>
    rows.current
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.adjust || row.activate || row.editable);

  // Start on something. About opens with two lines that only state a version,
  // so the first row is not always one the cursor belongs on. Children's
  // effects run before this one, so the rows are already registered by now.
  useEffect(() => {
    const first = stops()[0];
    setCursor(first ? first.index : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const here = () => rows.current[cursor];

  const goToSection = (next: Section) => {
    setSection(next);
    setCursor(0);
  };

  /** Put the keyboard back where the cursor is. A control left holding focus
   *  after a click would keep answering keys the dialog has already handled. */
  const takeBack = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== frame.current) active.blur();
    frame.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Tab is not part of the model -- everything here is reachable without it
    // -- but it is kept inside the dialog, because the dialog renders last in
    // the app's tree and the tab order would otherwise walk off the end of it
    // and into the window behind the scrim.
    if (e.key === "Tab" && frame.current) {
      const focusable = [...frame.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === frame.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    const action = settingsAction(e.key, isEditing(e.target), SECTIONS.length);
    if (action.kind === "none") return;

    // Handled here and nowhere else. Without this a focused select would take
    // the arrow as well and move twice, and Space on a focused checkbox would
    // toggle it back.
    e.preventDefault();
    e.stopPropagation();

    switch (action.kind) {
      case "close":
        onClose();
        return;

      case "leave":
        takeBack();
        return;

      case "section":
        goToSection(SECTIONS[action.index]!.id);
        takeBack();
        return;

      case "move": {
        const at = nextStop(
          stops().map(({ index }) => index),
          cursor,
          action.delta,
        );
        if (at !== null) setCursor(at);
        takeBack();
        return;
      }

      case "adjust":
        here()?.adjust?.(action.delta);
        return;

      case "activate": {
        const row = here();
        if (!row) return;
        // A box you type in takes the caret; everything else just happens.
        if (row.editable) focusRow.current(row.key);
        else row.activate?.();
        return;
      }
    }
  };

  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className={SCRIM} onMouseDown={onClose}>
      <div
        className={FRAME}
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDownCapture={onKeyDown}
      >
        <nav className={NAV} aria-label="Settings sections">
          <h2 className={TITLE} id={titleId}>
            Settings
          </h2>

          {SECTIONS.map((item, index) => (
            <button
              key={item.id}
              className={`${TAB} ${
                section === item.id
                  ? "bg-select border-l-accent font-semibold text-text"
                  : "border-l-transparent text-text-dim hover:bg-surface-alt hover:text-text"
              }`}
              // One tab stop for the whole list. The digits are the keyboard
              // route between sections, so tabbing through five headings to
              // reach the settings would be five stops that do nothing the
              // number keys do not already do.
              tabIndex={section === item.id ? 0 : -1}
              aria-current={section === item.id}
              onClick={() => goToSection(item.id)}
            >
              <kbd className={section === item.id ? "bg-accent border-accent text-white" : ""}>{index + 1}</kbd>
              <span>{item.label}</span>
            </button>
          ))}

          <p className={NAV_HINT}>
            <Keys>
              <kbd>1</kbd>–<kbd>{SECTIONS.length}</kbd> jump
            </Keys>{" "}
            ·{" "}
            <Keys>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move
            </Keys>{" "}
            ·{" "}
            <Keys>
              <kbd>←</kbd>
              <kbd>→</kbd> change
            </Keys>{" "}
            ·{" "}
            <Keys>
              <kbd>Enter</kbd> toggle
            </Keys>{" "}
            ·{" "}
            <Keys>
              <kbd>Esc</kbd> close
            </Keys>
          </p>
        </nav>

        <div className="overflow-y-auto px-12 pt-8 pb-12">
          <header className="mb-6 pb-4 border-b border-b-border">
            <h3 className="m-0 text-lead font-semibold tracking-[-0.01em]">{current.label}</h3>
            <p className="mt-1 mb-0 text-small text-text-dim">{current.blurb}</p>
          </header>

          <SettingsCursor value={{ index: cursor, setIndex: setCursor, register }}>
            {section === "general" && <GeneralSection />}
            {section === "diff" && <DiffSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "commands" && <CommandsSection />}
            {section === "updates" && <UpdatesSection />}
            {section === "about" && <AboutSection />}
          </SettingsCursor>
        </div>

        <button className={CLOSE} {...tip("Close settings")} onClick={onClose}>
          &times;
        </button>
      </div>
    </div>
  );
}

function GeneralSection() {
  const { settings, update } = useSettings();

  // The terminals come from the backend rather than being listed here, because
  // the backend is what knows how to start them.
  const terminals = useQuery({
    queryKey: ["terminalOptions"],
    queryFn: api.terminalOptions,
    staleTime: Infinity,
  });

  // The two that mean something without the backend: one is a decision not to
  // choose, the other is a command typed here. A picker with nothing in it
  // would leave no way to change the setting, which looks exactly like the
  // setting being ignored.
  const editors = useQuery({
    queryKey: ["editorOptions"],
    queryFn: api.editorOptions,
    staleTime: Infinity,
  });

  // Greyed by wording rather than hidden. "Why is mine not listed" answers
  // itself when the entry is there and says it was not found.
  const editorChoices = (
    editors.data?.length
      ? editors.data
      : [
          { id: "auto", label: "Choose automatically", installed: true },
          { id: "custom", label: "Custom command", installed: true },
        ]
  ).map((option) => ({
    value: option.id,
    label: option.installed ? option.label : `${option.label} (not installed)`,
  }));

  const available: TerminalOption[] = terminals.data?.length
    ? terminals.data
    : [
        { id: "auto", label: "Choose automatically" },
        { id: "custom", label: "Custom command" },
      ];

  // A settings file carried from another machine can name a terminal this one
  // has never heard of. Showing it keeps the picker honest about what is
  // stored, rather than silently displaying the first entry instead.
  const known = available.some((option) => option.id === settings.terminal);
  const choices = known
    ? available
    : [...available, { id: settings.terminal, label: `${settings.terminal} (not on this system)` }];

  const rows: Row[] = [
    selectRow(
      "theme",
      "Theme",
      "System follows Windows and changes with it while the app is open.",
      settings.theme,
      [
        { value: "system", label: "Follow the system" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
      (theme) => update({ theme: theme as Settings["theme"] }),
    ),

    toggleRow(
      "restoreTabs",
      "Reopen repositories on launch",
      "Restores the tabs that were open when you last closed the app.",
      settings.restoreTabs,
      (restoreTabs) => update({ restoreTabs }),
    ),

    toggleRow(
      "confirmDiscard",
      "Ask before discarding changes",
      "Discarding cannot be undone; git keeps no record of it.",
      settings.confirmDiscard,
      (confirmDiscard) => update({ confirmDiscard }),
    ),

    selectRow(
      "terminal",
      "Terminal",
      terminals.isError
        ? "This build cannot list the terminals it can start, which means it is older than the settings it is showing. Restart it for the full list; a custom command works either way."
        : "What “Open in terminal” starts. Choosing automatically tries the ones this system usually has.",
      settings.terminal,
      choices.map((option) => ({ value: option.id, label: option.label })),
      (terminal) => update({ terminal }),
    ),
  ];

  if (settings.terminal === "custom") {
    rows.push(
      textRow(
        "terminalCommand",
        "Terminal command",
        "{path} becomes the repository's folder. Quote anything containing spaces. This is not a shell — pipes, redirects and chained commands are treated as ordinary arguments.",
        settings.terminalCommand,
        "alacritty --working-directory {path}",
        (terminalCommand) => update({ terminalCommand }),
      ),
    );
  }

  rows.push(
    selectRow(
      "editor",
      "Code editor",
      editors.isError
        ? "This build cannot list editors, which means it is older than the settings it is showing. Restart it for the full list; a custom command works either way."
        : "What “Open in code editor” starts. Choosing automatically takes the first one installed. Vim and Neovim open inside your terminal, since they have no window of their own.",
      settings.editor,
      editorChoices,
      (editor) => update({ editor }),
    ),
  );

  if (settings.editor === "custom") {
    rows.push(
      textRow(
        "editorCommand",
        "Editor command",
        "{path} becomes the repository's folder. Quote anything containing spaces. Not a shell: pipes and chained commands are ordinary arguments.",
        settings.editorCommand,
        "code {path}",
        (editorCommand) => update({ editorCommand }),
      ),
    );
  }

  rows.push(
    numberRow(
      "historyPageSize",
      "History page size",
      "Commits loaded at a time as you scroll.",
      settings.historyPageSize,
      { min: 50, max: 2000, step: 50 },
      (historyPageSize) => update({ historyPageSize }),
    ),

    numberRow(
      "autoFetchMinutes",
      "Fetch in the background every",
      "Minutes between fetches of the open repository, so ahead and behind stay true. 0 turns it off. A failure is reported once, not every time.",
      settings.autoFetchMinutes,
      { min: 0, max: 120, step: 1 },
      (autoFetchMinutes) => update({ autoFetchMinutes }),
    ),

    numberRow(
      "sequenceTimeout",
      "Sequence timeout",
      "How long a two-key shortcut like G F waits for its second key, in milliseconds.",
      settings.sequenceTimeout,
      { min: 200, max: 3000, step: 100 },
      (sequenceTimeout) => update({ sequenceTimeout }),
    ),
  );

  return <SettingsRows rows={rows} />;
}

function DiffSection() {
  const { settings, update } = useSettings();

  return (
    <SettingsRows
      rows={[
        numberRow(
          "diffContextLines",
          "Context lines",
          "Unchanged lines shown around each change. Git's own default is 3.",
          settings.diffContextLines,
          { min: 0, max: 50, step: 1 },
          (diffContextLines) => update({ diffContextLines }),
        ),

        selectRow(
          "diffLayout",
          "Layout",
          "Unified shows one column with + and - lines. Side by side shows the old text on the left and the new on the right.",
          settings.diffLayout,
          [
            { value: "unified", label: "Unified" },
            { value: "split", label: "Side by side" },
          ],
          (diffLayout) => update({ diffLayout: diffLayout as Settings["diffLayout"] }),
        ),

        toggleRow(
          "ignoreWhitespace",
          "Ignore whitespace",
          "Hides lines that differ only in spacing. Useful after a reformat, misleading in a language where indentation is syntax.",
          settings.ignoreWhitespace,
          (ignoreWhitespace) => update({ ignoreWhitespace }),
        ),
      ]}
    />
  );
}

function ShortcutsSection() {
  const { settings, keymap, update } = useSettings();
  const tip = useTip();
  const cursor = useSettingsCursor();
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

  // The rows the cursor moves over, in the order they appear. Registered here
  // rather than rendered by SettingsRows, because this section draws its own
  // grouped list -- but the keys that drive it are the dialog's, so Shortcuts
  // answers up and down like every other section instead of needing Tab.
  const flat = [...groups.values()].flat();

  useEffect(() => {
    cursor?.register(
      flat.map((command) => ({
        key: command.id,
        label: command.label,
        control: null,
        // Enter records another key for the command, which is what the "+"
        // at the end of the row does.
        activate: () => setEditing(`${command.id}:new`),
      })),
      () => {},
    );
  });

  const at = flat[cursor?.index ?? -1];

  const setBindings = (id: string, bindings: string[]) =>
    update({ keymap: { ...settings.keymap, [id]: bindings } });

  const resetBinding = (id: string) => {
    const next = { ...settings.keymap };
    delete next[id];
    update({ keymap: next });
  };

  return (
    <>
      <div className="mb-3 flex items-center gap-4">
        <FilterInput
          value={filter}
          onChange={setFilter}
          placeholder="Filter commands"
          matches={shown.length}
          className="flex-1"
        />
        <button
          className="btn"
          disabled={changedCount === 0}
          {...tip("Reset all", undefined, "Every shortcut back to what it ships with")}
          onClick={() => update({ keymap: {} })}
        >
          Reset all{changedCount > 0 && ` (${changedCount})`}
        </button>
      </div>

      <p className={NOTE_TIGHT}>
        Click a key to record a new one. Escape cancels, Backspace clears.
      </p>

      {conflicts.length > 0 && (
        <p className={WARNING}>
          {conflicts.length === 1 ? "One key is" : `${conflicts.length} keys are`} bound twice
          in a way that can collide. Whichever was registered last wins.
        </p>
      )}

      {[...groups].map(([category, commands]) => (
        <section key={category} className="mb-8">
          <h4 className={GROUP_HEADING}>{category}</h4>

          {commands.map((command) => (
            <ShortcutRow
              key={command.id}
              at={command.id === at?.id}
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
        <p className="text-text-faint">
          No command matches that. Try a category, like “git” or “panels”.
        </p>
      )}
    </>
  );
}

function ShortcutRow({
  at,
  command,
  bindings,
  changed,
  rivals,
  editing,
  onEditing,
  onSet,
  onReset,
}: {
  /** The keyboard cursor is on this row. */
  at: boolean;
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
  const tip = useTip();
  const slot = (index: number) => `${command.id}:${index}`;
  const recordingIndex = bindings.findIndex((_, i) => editing === slot(i));
  const addingNew = editing === `${command.id}:new`;

  const replace = (index: number, binding: string) =>
    onSet(bindings.map((existing, i) => (i === index ? binding : existing)));

  const remove = (index: number) => onSet(bindings.filter((_, i) => i !== index));

  return (
    <div
      // A hook that does not move when the styling does. The tests used to
      // find these rows by their class, which tied them to a stylesheet
      // rather than to what the row is.
      data-command={command.id}
      data-at={at || undefined}
      ref={(node) => {
        // Follow the cursor. A list this long scrolls well past the pane, and
        // a selection you cannot see is one you will change by accident.
        if (at) node?.scrollIntoView({ block: "nearest" });
      }}
      className={[
        ROW,
        rivals.length > 0 && "shadow-[inset_3px_0_0_var(--color-modified)]",
        at ? "bg-select" : "hover:bg-surface-alt",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={LABEL}>
        {command.label}
        {changed && (
          <span className="size-[5px] flex-none rounded-full bg-accent" {...tip("Changed from the default")} />
        )}
      </span>

      <span className={KEYS}>
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
            className={ADD}
            {...tip("Add another key for this command")}
            onClick={() => onEditing(`${command.id}:new`)}
          >
            +
          </button>
        )}

        {bindings.length === 0 && !addingNew && (
          <span className="text-small text-text-faint">not bound</span>
        )}
      </span>

      <button className="link-button hover-only" disabled={!changed} onClick={onReset}>
        reset
      </button>

      {rivals.length > 0 && (
        <span className={CONFLICT}>
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
  const tip = useTip();
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
      <button
        className={`${KEY} ${RECORDING}`}
        data-recording
        onClick={recorder.cancelRecording}
      >
        {recorder.recordedHotkey ? formatBinding(recorder.recordedHotkey) : "Press a key…"}
      </button>
    );
  }

  return (
    <span className="relative inline-flex items-center">
      <button
        className={KEY}
        {...tip("Record a different key")}
        onClick={onStart}
      >
        <kbd>{formatBinding(binding)}</kbd>
      </button>
      <button className={`${REMOVE} hover-only`} {...tip("Remove this key")} onClick={onRemove}>
        &times;
      </button>
    </span>
  );
}

function UpdatesSection() {
  const { settings, update } = useSettings();
  const updater = useUpdater(false);

  const rows: Row[] = [
    toggleRow(
      "checkForUpdates",
      "Check for updates on launch",
      "A quiet check a few seconds after opening. Nothing downloads without you asking.",
      settings.checkForUpdates,
      (checkForUpdates) => update({ checkForUpdates }),
    ),

    actionRow("checkNow", "Check now", describe(updater.stage), {
      label: updater.stage.state === "checking" ? "Checking…" : "Check for updates",
      disabled: updater.stage.state === "checking",
      onPress: () => void updater.checkNow(),
    }),
  ];

  if (updater.stage.state === "available") {
    rows.push(
      actionRow(
        "install",
        `Version ${updater.stage.version}`,
        "Downloads, then asks before restarting.",
        { label: "Install", primary: true, onPress: () => void updater.install() },
      ),
    );
  }

  return (
    <>
      <SettingsRows rows={rows} />

      <p className={NOTE}>
        Updates are signed. Braid refuses anything that is not signed with the key this
        build was made against, so a release has to come from whoever holds that key.
      </p>
    </>
  );
}

/** The user's commands, read back so a typo in the file is visible here
 *  rather than as a menu entry that never appears. Written in the file
 *  itself: a form for a shell line with placeholders and prompts would be a
 *  worse editor than the one they already have. */
function CommandsSection() {
  const { settings } = useSettings();

  const rows: Row[] = settings.customCommands.map((command, index) =>
    staticRow(
      `custom-${index}`,
      command.label,
      <span className="font-mono">{command.command}</span>,
      <span className="flex items-center gap-3 text-small text-text-dim">
        {command.context}
        {command.key && <kbd>{command.key}</kbd>}
      </span>,
    ),
  );

  if (rows.length === 0) {
    rows.push(
      staticRow(
        "none",
        "No commands yet",
        <>
          Add a <span className="font-mono">customCommands</span> list to the settings file. Each
          entry has a label, a command line, a context -- global, branch, commit, file,
          remote, stash or tag -- and may have a key, prompts and a confirm message.
          Placeholders: <span className="font-mono">{"{{branch}} {{commit}} {{file}} {{remote}} {{stash}} {{tag}} {{head}} {{repo}} {{prompt.key}}"}</span>.
        </>,
        null,
      ),
    );
  }

  rows.push(
    actionRow(
      "edit",
      "Edit the settings file",
      "Opens settings.json in your editor. Changes are read the next time the app starts.",
      {
        label: "Open",
        onPress: () =>
          void api.openSettingsFile(settings.editor, settings.editorCommand, settings.terminal),
      },
    ),
  );

  return <SettingsRows rows={rows} />;
}

function AboutSection() {
  const app = useAppVersion();

  const rows: Row[] = [
    staticRow(
      "version",
      "Braid",
      "A fast, keyboard-first Git client.",
      <span className="font-mono text-small text-text-dim">{app.version || "unknown"}</span>,
    ),
  ];

  if (app.channel) {
    rows.push(
      staticRow(
        "channel",
        `This is ${app.channel === "rc" ? "a" : "an"} ${channelLabel(app.channel)}`,
        channelCaution(app.channel),
        <span className={`channel channel-${app.channel}`}>{channelLabel(app.channel)}</span>,
      ),
    );
  }

  return (
    <>
      <SettingsRows rows={rows} />

      <p className={NOTE}>
        Settings, shortcuts and the list of open repositories are stored as JSON beside the
        app's own config, so they can be read, edited or deleted by hand.
      </p>

      <p className={NOTE}>
        Writes go through your own <span className="mono">git</span>, so hooks, credential
        helpers, signing and LFS behave exactly as they do in your terminal. Braid never asks
        for a password itself.
      </p>
    </>
  );
}

function describe(stage: ReturnType<typeof useUpdater>["stage"]): string {
  switch (stage.state) {
    case "checking":
      return "Asking the release server…";
    case "upToDate":
      return "This is the newest version.";
    case "available":
      return `Version ${stage.version} is available.`;
    case "downloading":
      return stage.percent === null ? "Downloading…" : `Downloading, ${stage.percent}%.`;
    case "ready":
      return "Installed. It takes effect on restart.";
    case "failed":
      return stage.message;
    default:
      return "Braid asks GitHub whether a newer release has been published.";
  }
}
