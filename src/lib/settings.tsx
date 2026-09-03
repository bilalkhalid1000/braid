import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api, type HistoryScope } from "./api";
import { resolveKeymap, type Keymap } from "./commands";

export type ThemeChoice = "system" | "light" | "dark";

export interface Settings {
  theme: ThemeChoice;
  /** Reopen the repositories that were open last time. */
  restoreTabs: boolean;
  /** Ask before throwing away working-tree changes. */
  confirmDiscard: boolean;
  /** Lines of unchanged context around each diff hunk. */
  diffContextLines: number;
  ignoreWhitespace: boolean;
  /** Commits fetched per page in the history view. */
  historyPageSize: number;
  /** Which branches the history view walks. */
  historyScope: HistoryScope;
  /** How long a multi-key sequence waits for its next chord, in ms. */
  sequenceTimeout: number;
  /** Look for a new version shortly after launch. */
  checkForUpdates: boolean;
  /** Which terminal "Open in terminal" starts. An id from the backend's list,
   *  or "auto" to let it pick. */
  terminal: string;
  /** The command line to run when terminal is "custom". {path} is replaced
   *  with the repository's folder. */
  terminalCommand: string;
  /** Which code editor "Open in editor" starts. An id from the backend's
   *  list, or "auto" for the first one installed. */
  editor: string;
  /** The command line to run when editor is "custom". {path} is replaced
   *  with the repository's folder. */
  editorCommand: string;
  /** Only the commands the user has actually rebound. Values are lists, so a
   *  command can answer to several keys. */
  keymap: Keymap;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  restoreTabs: true,
  confirmDiscard: true,
  diffContextLines: 3,
  ignoreWhitespace: false,
  historyPageSize: 300,
  // Every branch and tag, which is what a history view is usually opened to
  // see. Walking HEAD alone hides the other branches entirely.
  historyScope: "all",
  sequenceTimeout: 700,
  checkForUpdates: true,
  terminal: "auto",
  terminalCommand: "",
  editor: "auto",
  editorCommand: "",
  keymap: {},
};

interface SettingsContextValue {
  settings: Settings;
  /** Bindings with the user's overrides already applied. */
  keymap: Keymap;
  update: (patch: Partial<Settings>) => void;
  /** False until the stored file has been read, so nothing is written over it. */
  loaded: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const lastSaved = useRef<string>("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stored = await api.loadSettings();
        if (cancelled) return;

        // Merged field by field, so a file written before a setting existed
        // still yields a complete object rather than undefined holes.
        setSettings({ ...DEFAULT_SETTINGS, ...stored });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;

    // Compared as text so an unrelated re-render does not rewrite the file.
    const encoded = JSON.stringify(settings);
    if (encoded === lastSaved.current) return;

    lastSaved.current = encoded;
    void api.saveSettings(settings);
  }, [loaded, settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const keymap = useMemo(() => resolveKeymap(settings.keymap), [settings.keymap]);

  const value = useMemo(
    () => ({ settings, keymap, update, loaded }),
    [settings, keymap, update, loaded],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside a SettingsProvider");
  return value;
}
