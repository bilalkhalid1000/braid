import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useKeyHold } from "@tanstack/react-hotkeys";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  api,
  flowNoun,
  isReleaseKind,
  onCloneProgress,
  onRepoChanged,
  type Commit,
  type CurrentFlow,
  type ResetMode,
  type BlameTarget,
  type BranchRef,
  type BisectVerdict,
  type RebaseAction,
  type RebasePlan,
  type RemoteGroup,
  type StashEntry,
  type FlowKind,
  type StatusEntry,
  type RepoInfo,
} from "./lib/api";
import { Toolbar, type ToolbarAction } from "./components/Toolbar";
import {
  Sidebar,
  isSidebarPanel,
  PANELS,
  type MenuTarget,
  type PanelId,
  type Point,
  type WorkspaceView,
} from "./components/Sidebar";
import { ContextMenu, type MenuEntry, type MenuState } from "./components/ContextMenu";
import { FileStatusView } from "./components/FileStatusView";
import { HistoryView } from "./components/HistoryView";
import { StashView } from "./components/StashView";
import { KeyHints } from "./components/KeyHints";
import { RebaseEditor } from "./components/RebaseEditor";
import { customId, fill, type CustomCommand, type CustomContext } from "./lib/customCommands";
import type { CommandDef } from "./lib/commands";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  branchUrl,
  commitUrl,
  hostingOf,
  newPullRequestUrl,
  pullRequestNoun,
  type Hosting,
} from "./lib/hosting";
import type { CommandScope } from "./lib/commands";
import { Dialog, type DialogSpec } from "./components/Dialog";
import type { ComboOption } from "./components/Combo";
import { cloneDestination, repoNameFromUrl } from "./lib/cloneTarget";
import { applyOrder, moveItem } from "./lib/tabOrder";
import { useLibrary } from "./lib/useLibrary";
import {
  displayName,
  find as findBookmark,
  samePath,
  LIBRARY_TAB,
} from "./lib/library";
import { RepoLibrary } from "./components/RepoLibrary";
import { RepoTabs } from "./components/RepoTabs";
import { splitUpstream } from "./lib/upstream";
import { FlowPlan, type FlowPlanTarget } from "./components/FlowPlan";
import { BlameView } from "./components/BlameView";
import { SearchView } from "./components/SearchView";
import { Splash } from "./components/Splash";
import { IconSearch, IconSettings } from "./components/icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Toaster } from "./components/Toaster";
import { ActivityLog } from "./components/ActivityLog";
import { OperationBanner } from "./components/OperationBanner";
import { UpdateBanner } from "./components/UpdateBanner";
import { Splitter, usePaneSize } from "./components/Splitter";
import { SettingsDialog } from "./components/SettingsDialog";
import { CommandPalette } from "./components/CommandPalette";
import { useTip } from "./components/Tip";
import type { CommitBoxHandle } from "./components/CommitBox";
import { useTheme } from "./lib/useTheme";
import { useSettings } from "./lib/settings";
import { everHadTabs, mayWriteSession } from "./lib/session";
import { useCopy } from "./lib/useCopy";
import { useCommands } from "./lib/useCommands";
import { shortcutLabel } from "./lib/shortcutLabel";
import { messageOf, useActivity } from "./lib/useActivity";
import { gitCommandLine, useGitLog } from "./lib/useGitLog";
import { useUpdater } from "./lib/useUpdater";
import { useAppVersion } from "./lib/useAppVersion";
import { channelCaution, channelLabel } from "./lib/version";
import type { HintAction } from "./lib/gitHints";
import {
  IconBranch,
  IconCommit,
  IconDiscard,
  IconFetch,
  IconFlow,
  IconFolder,
  IconMerge,
  IconPull,
  IconPush,
  IconStash,
  IconTerminal,
  IconCode,
  IconSubmodule,
  IconWorktree,
} from "./components/icons";
import "./styles.css";

/** Cache keys invalidated when a repo reports that its state changed. */
const REPO_QUERY_KEYS = [
  "status",
  "refs",
  "log",
  "diff",
  "worktrees",
  "submodules",
  "flow",
  "reflog",
  "bisect",
];

const TABS =
  "flex h-15 flex-none items-stretch bg-chrome-alt border-b border-b-border";

const SETTINGS_BUTTON =
  "flex w-17 flex-none items-center justify-center p-0 bg-transparent border-0 " +
  "border-l border-l-border text-text-dim cursor-pointer hover:bg-chrome hover:text-text " +
  "[&_svg]:size-[15px]";

const STATUSBAR =
  "flex h-12 flex-none items-center gap-8 overflow-hidden px-4 bg-chrome " +
  "border-t border-t-border text-small whitespace-nowrap text-text-dim";

const BRANCH =
  "px-3 bg-transparent border-0 rounded-sm font-mono text-small font-semibold " +
  "text-accent cursor-pointer hover:bg-accent-soft";

const ACTIVITY =
  "flex max-w-[300px] items-center gap-3 overflow-hidden text-ellipsis text-text";

/* Capped: the point is to say something is running, not to print the argv --
   the tooltip carries the rest. */
const RUNNING =
  "flex min-w-0 max-w-[40ch] items-center gap-3 overflow-hidden text-ellipsis " +
  "whitespace-nowrap font-mono text-micro text-text-faint";

const STATUS_BUTTON =
  "flex items-center gap-3 px-3 bg-transparent border-0 rounded-sm text-small " +
  "text-text-dim cursor-pointer hover:bg-surface-alt hover:text-text";

const ERROR_COUNT =
  "min-w-[15px] px-2 rounded-full bg-removed text-center font-mono text-micro " +
  "leading-[14px] text-white";

export default function App() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("status");
  // Which region the keyboard is driving. Files and History are the main
  // panel; the rest are sidebar lists.
  const [focusedPanel, setFocusedPanel] = useState<PanelId>("files");
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  /** An interactive rebase being planned, and the action a menu asked for. */
  const [rebase, setRebase] = useState<{
    plan: RebasePlan;
    preset?: { oid: string; action: RebaseAction };
  } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  // The file being blamed, if any. Blame takes over the main panel
  // rather than becoming a third workspace view, so the number keys and
  // the sidebar keep meaning exactly what they meant before.
  const [blameTarget, setBlameTarget] = useState<BlameTarget | null>(null);
  /** The stash being read in the main panel, if any. Takes the panel over
   *  the way a blame does, and for the same reason. */
  const [stashShown, setStashShown] = useState<StashEntry | null>(null);
  /** The search panel is showing over the main panel. */
  const [searchOpen, setSearchOpen] = useState(false);
  /** A commit the history view should select, set by a search result. */
  const [historyFocus, setHistoryFocus] = useState<string | null>(null);
  /** Whether the repository list has a tab in the strip. */
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** What the sidebar's keyboard cursor is on, so Merge can act on it. */
  const [sidebarCursor, setSidebarCursor] = useState<MenuTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<false | "general" | "shortcuts">(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Nothing may be written back until the restore has finished, or the first
  // save would overwrite the stored session with an empty list.
  const [restored, setRestored] = useState(false);
  /** Tab order, by repo id. The backend lists repositories alphabetically,
   *  which is a default rather than an arrangement; this is the arrangement. */
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  /** How many tabs the restore is reopening, so the wait can say so. */
  const [restoring, setRestoring] = useState(0);
  /** What was open last time, when the preference says not to reopen it. The
   *  list offers it rather than the app doing it unasked. */
  const [lastSession, setLastSession] = useState<string[]>([]);
  /** Reveal the app even if the restore never finishes.
   *
   *  Deliberately a separate flag from `restored`, which also gates writing the
   *  session back: forcing that one would let an empty repo list overwrite what
   *  is stored. This only decides whether the splash is still up. */
  const [bootTimedOut, setBootTimedOut] = useState(false);
  /** What a running clone is doing, or null when none is. */
  const [cloning, setCloning] = useState<string | null>(null);
  const { settings, keymap, update: updateSettings, loaded: settingsLoaded } = useSettings();
  const { copy } = useCopy();
  const tipFor = useTip();

  /** Numbers jump to a panel. Files and History also switch the main view;
   *  the sidebar panels leave it alone so you can browse branches while still
   *  looking at history. */
  const focusPanel = (panel: PanelId) => {
    if (panel === "files") setView("status");
    if (panel === "history") setView("history");
    // A blame covers the main panel, so asking for a panel has to close it --
    // otherwise pressing 2 would look like it did nothing.
    if (panel === "files" || panel === "history") {
      setBlameTarget(null);
      setStashShown(null);
      setSearchOpen(false);
    }
    setFocusedPanel(panel);
  };
  // A hung IPC call must not strand the window on a splash. The shell appears
  // regardless after this; the restore keeps running and tabs arrive when they
  // do. The backend shows the window on a similar backstop for the same reason.
  useEffect(() => {
    const timer = window.setTimeout(() => setBootTimedOut(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  // A clone reports many times a second; this only ever holds the latest, so
  // the render cost is one short string however large the repository is.
  useEffect(() => {
    const stop = onCloneProgress(({ phase, percent }) =>
      setCloning(percent === null ? phase : `${phase} ${percent}%`),
    );
    return () => void stop.then((off) => off());
  }, []);

  const themeResolved = useTheme(settings.theme);

  /** Re-read everything for the open repository.
   *
   *  The app is event driven and should not need this -- a watcher pushes
   *  changes as they happen. It exists because something done outside the app
   *  can still be missed, and because a user who does not trust a view wants a
   *  way to insist rather than a promise that it is fine. */
  const refreshAll = async () => {
    await queryClient.invalidateQueries();
    activity.note("Refreshed", "Re-read the repository from disk.", "success");
  };

  /** Close the window.
   *
   *  Single-key commands never fire while a text field has focus, so this
   *  cannot interrupt a commit message being typed. Tabs come back on the next
   *  launch; anything typed into the message box does not. */
  const quit = () => getCurrentWindow().close();

  const cycleTheme = () => {
    const order = ["system", "light", "dark"] as const;
    const next = order[(order.indexOf(settings.theme) + 1) % order.length];
    updateSettings({ theme: next });
  };
  const activity = useActivity();
  const gitLog = useGitLog();
  const library = useLibrary();
  const [sidebarWidth, setSidebarWidth] = usePaneSize("sidebar", 232);
  const updater = useUpdater(settingsLoaded && settings.checkForUpdates);
  const app = useAppVersion();
  const commitRef = useRef<CommitBoxHandle>(null);
  const tip = useTip();

  // Holding the modifier reveals which digit goes with which tab. The numbers
  // stay hidden the rest of the time: they are an answer to "which one is it",
  // and that question is only ever asked with the key already down.
  const ctrlHeld = useKeyHold("Control");
  const metaHeld = useKeyHold("Meta");
  const modHeld = ctrlHeld || metaHeld;

  // Whether any editor is installed decides if the toolbar button is live. A
  // custom command is taken on trust: the user wrote it, and the only way to
  // find out it is wrong is to run it.
  const editors = useQuery({
    queryKey: ["editorOptions"],
    queryFn: api.editorOptions,
    staleTime: Infinity,
  });
  const editorReady =
    settings.editor === "custom" ||
    (editors.data ?? []).some((editor) => editor.id !== "custom" && editor.installed);

  const repos = useQuery({
    queryKey: ["repos"],
    queryFn: api.listRepos,
    initialData: [] as RepoInfo[],
  });

  // Every repo-scoped read shares these options: no polling and no refetch on
  // focus. The backend's filesystem watcher is the only thing that invalidates
  // them, which is what keeps many open tabs from costing anything at idle.
  const eventDriven = {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  } as const;

  const status = useQuery({
    queryKey: ["status", activeId],
    queryFn: () => api.repoStatus(activeId!),
    enabled: activeId !== null,
    ...eventDriven,
  });

  const refs = useQuery({
    queryKey: ["refs", activeId],
    queryFn: () => api.repoRefs(activeId!),
    enabled: activeId !== null,
    ...eventDriven,
  });

  const bisect = useQuery({
    queryKey: ["bisect", activeId],
    queryFn: () => api.bisectStatus(activeId!),
    // Only while one runs: the marks are the whole point, and outside a
    // bisect there are none.
    enabled: activeId !== null && status.data?.state === "bisecting",
    ...eventDriven,
  });

  const reflogQuery = useQuery({
    queryKey: ["reflog", activeId],
    // A screenful and some. The whole reflog runs to thousands of entries in
    // an old repository, and the way back is nearly always near the top.
    queryFn: () => api.reflog(activeId!, 200),
    enabled: activeId !== null && status.data !== undefined,
    ...eventDriven,
  });

  const worktrees = useQuery({
    queryKey: ["worktrees", activeId],
    queryFn: () => api.listWorktrees(activeId!),
    // After the status, not alongside it. On a cold disk every git process
    // that starts at once contends for the same pack files, and the ones that
    // feed the sidebar's lower panels are not what anyone is waiting to see.
    enabled: activeId !== null && status.data !== undefined,
    ...eventDriven,
  });

  const submodules = useQuery({
    queryKey: ["submodules", activeId],
    queryFn: () => api.listSubmodules(activeId!),
    // After the status, not alongside it. On a cold disk every git process
    // that starts at once contends for the same pack files, and the ones that
    // feed the sidebar's lower panels are not what anyone is waiting to see.
    enabled: activeId !== null && status.data !== undefined,
    ...eventDriven,
  });

  const flow = useQuery({
    queryKey: ["flow", activeId],
    queryFn: () => api.flowStatus(activeId!),
    // After the status, not alongside it. On a cold disk every git process
    // that starts at once contends for the same pack files, and the ones that
    // feed the sidebar's lower panels are not what anyone is waiting to see.
    enabled: activeId !== null && status.data !== undefined,
    ...eventDriven,
  });

  // Reopen the tabs that were open last time.
  //
  // Repositories that have since been moved or deleted are skipped rather than
  // failing the whole restore, and reported once at the end instead of as one
  // error per repository.
  useEffect(() => {
    // Not until the stored preference is actually known.
    //
    // settingsLoaded is a dependency, so this effect ran twice: once against
    // the defaults and again once the file had been read. The first run opened
    // every repository in the session and was then cancelled mid-flight by the
    // second, which left them open in the backend but absent from the window --
    // an empty tab strip that a reload appeared to fix, because by then the
    // repositories really were open and the list query simply found them.
    if (!settingsLoaded) return;

    let cancelled = false;

    void (async () => {
      try {
        // Read it either way. Turning "reopen repositories" off means do not
        // open them for me -- not forget which they were. Skipping the read
        // left the window with no idea a previous session existed, so the only
        // route back to yesterday's tabs was to remember the paths yourself.
        const stored = await api.loadSession();
        if (cancelled) return;

        if (!settings.restoreTabs) {
          setLastSession(stored.repos);
          return;
        }

        setRestoring(stored.repos.length);

        // Opened together rather than one after another. Each one discovers the
        // repository and starts a filesystem watcher, and in series the wait was
        // the sum of all of them -- which is the wait the window sits through.
        // Promise.all keeps the input order, so the first stored tab is still
        // the one selected.
        const results = await Promise.all(
          stored.repos.map(async (path) => {
            try {
              return { path, id: (await api.openRepo(path)).id };
            } catch {
              return { path, id: null };
            }
          }),
        );

        if (cancelled) return;

        const opened = results.flatMap((r) => (r.id ? [r.id] : []));

        // The session stores tabs in the order they were shown, so restoring
        // that list restores the arrangement as well as the contents.
        setTabOrder(opened);

        // A session written before this list existed still names real
        // repositories; adopting them means an upgrade does not start empty.
        for (const path of stored.repos) library.add(path);
        const missing = results.flatMap((r) => (r.id ? [] : [r.path]));

        await queryClient.invalidateQueries({ queryKey: ["repos"] });

        setActiveId(
          stored.active && opened.includes(stored.active) ? stored.active : (opened[0] ?? null),
        );

        if (missing.length > 0) {
          activity.note(
            `${missing.length} ${missing.length === 1 ? "repository" : "repositories"} could not be reopened`,
            ["These paths no longer exist:", ...missing].join("\n"),
            "error",
          );
        }
      } finally {
        if (!cancelled) setRestored(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Runs once the stored settings are known, so the preference is honoured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, settingsLoaded]);

  // A background repo emitting a change only invalidates its own cache entries.
  // Nothing is recomputed until that tab is actually looked at.
  useEffect(() => {
    const unlisten = onRepoChanged((id) => {
      for (const key of REPO_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key, id] });
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  /** The repositories in the order their tabs are shown.
   *
   *  Everything that counts tabs — the number keys, cycling, the session file —
   *  reads this rather than the query, or the arrangement on screen and the one
   *  those act on would be two different things. */
  /** The repository tabs, in the order their tabs are shown. */
  const repoTabs = useMemo(
    () =>
      applyOrder(repos.data, tabOrder, (repo) => repo.id).map((repo) => {
        // The name comes from the library when one was chosen there, so
        // renaming a tab and renaming a list entry are the same act.
        const listed = findBookmark(library.repos, repo.root);
        return listed ? { ...repo, name: displayName(listed) } : repo;
      }),
    [repos.data, tabOrder, library.repos],
  );

  /** Everything in the strip, which is the repositories plus the list itself
   *  when it has been opened. It closes like any other tab. */
  const tabs = useMemo(
    () =>
      libraryOpen
        ? [...repoTabs, { id: LIBRARY_TAB, name: "Repositories", root: "" }]
        : repoTabs,
    [repoTabs, libraryOpen],
  );

  /** Something in front whenever there is something to be in front of.
   *
   *  Tabs can outlive the selection. The backend keeps repositories open across
   *  a frontend reload, and a launch with "reopen repositories" turned off
   *  never picks one, so the strip ends up full of tabs with none of them
   *  current -- and the window shows the repository list instead, which reads
   *  as the tabs having stopped working rather than as nothing being selected.
   */
  useEffect(() => {
    if (activeId !== null) return;

    const first = repoTabs[0];
    if (first) setActiveId(first.id);
  }, [activeId, repoTabs]);

  /** The list is the whole window when it is the tab in front, and when there
   *  is no repository open at all — an empty app has nothing else to show. */
  const showLibrary = activeId === LIBRARY_TAB || repoTabs.length === 0;

  /** Whether the strip on screen is this window's own state yet.
   *
   *  Latched, because the session file is the only record of what was open and
   *  writing it from a window that has not established its tabs erases that
   *  record rather than saving nothing. Turning "reopen repositories" off used
   *  to do exactly that: the restore was skipped, startup was marked finished
   *  regardless, and the first write emptied the file.
   */
  const [hadTabs, setHadTabs] = useState(false);

  useEffect(() => {
    setHadTabs((already) => everHadTabs(already, repoTabs.length));
  }, [repoTabs.length]);

  // A string rather than the array, so a refetch that returns an identical list
  // does not rewrite the file.
  const sessionKey = JSON.stringify([repoTabs.map((r) => r.root), activeId]);

  useEffect(() => {
    if (!mayWriteSession({ settled: restored, hadTabs })) return;

    void api.saveSession({
      repos: repoTabs.map((r) => r.root),
      active: activeId,
    });
    // sessionKey is the value that decides whether a write is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, hadTabs, sessionKey]);

  const activeRepo = tabs.find((r) => r.id === activeId && r.id !== LIBRARY_TAB);
  const head = status.data;
  // Null while the repository list is the tab in front: everything scoped to a
  // repository has none, which is exactly true.
  const id = activeId === LIBRARY_TAB ? null : activeId;
  const busy = activity.running.length > 0;

  /** Run a git action with a name attached.
   *
   *  The label is what the user sees in the toast, the status bar and the
   *  activity log, so it is written as the thing they asked for rather than
   *  the command that implements it. */
  const perform = async (
    label: string,
    action: () => Promise<unknown>,
    source?: string,
  ) => {
    const ok = await activity.run(label, action, source);

    // Refresh straight away rather than waiting on the filesystem watcher.
    // Some operations (fetch, in particular) change refs without touching
    // anything the watcher would notice quickly.
    if (ok && id) {
      for (const key of REPO_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey: [key, id] });
      }
    }

    return ok;
  };

  const act = (label: string, action: () => Promise<unknown>, source?: string) => {
    void perform(label, action, source);
  };

  /** Toolbar buttons whose operation is running right now. */
  const workingOn = new Set(
    activity.running.map((entry) => entry.source).filter(Boolean),
  );

  const addRepo = (path: string) =>
    perform(`Open ${path}`, async () => {
      const repo = await api.openRepo(path);
      await queryClient.invalidateQueries({ queryKey: ["repos"] });

      // Remembered by its real root rather than the path that was picked: a
      // subfolder of a repository opens the repository, and the list should
      // hold the thing that was opened.
      library.add(repo.root);
      setActiveId(repo.id);
      return `Opened ${repo.root}`;
    });

  /** Open a repository from the list, or go to its tab if it already has one. */
  const openFromLibrary = async (path: string) => {
    const already = tabs.find((repo) => samePath(repo.root, path));
    if (already) {
      setActiveId(already.id);
      return;
    }

    await addRepo(path);
  };


  /** Take a repository off the list.
   *
   *  Asks first, not because the folder is at risk -- it is untouched -- but
   *  because the entry carries a name you chose, and that is the part that
   *  would be gone. */
  const confirmForgetRepo = (path: string) => {
    const listed = findBookmark(library.repos, path);

    setDialog({
      title: `Remove ${listed ? displayName(listed) : path}`,
      message: `${path}

Takes it off this list only. Nothing on disk is touched, and you can add it again from the same folder.`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: () => library.remove(path),
    });
  };

  /** Show the repository list, as a tab in the strip. */
  const openLibraryTab = () => {
    setLibraryOpen(true);
    setActiveId(LIBRARY_TAB);
  };

  /** Edit a repository: what it is called, and where it is.
   *
   *  One dialog rather than a rename here and a folder picker there. They are
   *  one edit — a repository that moved usually gets a new name at the same
   *  time — and splitting them meant two ways to change one entry. */
  const editRepo = (root: string) => {
    const listed = findBookmark(library.repos, root);
    const folderName = displayName({ path: root, name: "" });

    setDialog({
      title: `Edit ${listed ? displayName(listed) : folderName}`,
      fields: [
        {
          key: "name",
          label: "Show it as",
          value: listed?.name ?? "",
          placeholder: folderName,
          optional: true,
          describe: (value) =>
            value.trim() === "" ? `Uses the folder’s own name, ${folderName}.` : undefined,
        },
        {
          key: "path",
          label: "Folder",
          value: root,
          browse: true,
          describe: (value) =>
            samePath(value, root)
              ? undefined
              : "Points this entry at a different folder. Nothing on disk moves.",
        },
      ],
      confirmLabel: "Save",
      onConfirm: (v) => {
        // Added first for a repository opened before this list existed, so an
        // edit cannot quietly go nowhere.
        library.add(root);

        if (!library.edit(root, { path: v.path, name: v.name })) {
          activity.note(
            "Edit repository",
            `${v.path} is already on the list. Two entries for one repository would only disagree with each other.`,
            "error",
          );
        }
      },
    });
  };

  const openRepo = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") await addRepo(picked);
  };

  const createRepo = () =>
    setDialog({
      title: "Create repository",
      message:
        "Creates the folder if it does not exist, runs git init in it, and opens it as a tab. An existing folder with files in it is fine — that is how a project starts being tracked.",
      fields: [
        { key: "parent", label: "Where to put it", browse: true, placeholder: "E:/Projects" },
        { key: "name", label: "Folder name", placeholder: "my-project" },
        {
          key: "branch",
          label: "First branch",
          placeholder: "leave empty to use your git default",
          optional: true,
        },
      ],
      confirmLabel: "Create repository",
      onConfirm: (v) => {
        const path = `${v.parent.replace(/[\/]+$/, "")}/${v.name}`;

        void perform(`Create repository ${v.name}`, async () => {
          const repo = await api.initRepo(path, v.branch);
          await queryClient.invalidateQueries({ queryKey: ["repos"] });
          setActiveId(repo.id);
          return `Created ${repo.root}`;
        });
      },
    });

  const cloneRepo = () =>
    setDialog({
      title: "Clone repository",
      message:
        "Copies a remote repository into a new folder and opens it as a tab. Private repositories use whatever credential helper git is already configured with — you will not be asked for a password here.",
      fields: [
        {
          key: "url",
          label: "Repository URL",
          placeholder: "https://github.com/owner/repo.git",
        },
        {
          key: "parent",
          label: "Where to put it",
          browse: true,
          placeholder: `${activeRepo?.root.replace(/[\/][^\/]*$/, "") ?? "E:/Projects"}`,
        },
        {
          key: "name",
          label: "Folder name",
          placeholder: "taken from the URL",
          optional: true,
          describe: (value) =>
            value.trim() === "" ? "Uses the name in the URL, as git would." : undefined,
        },
      ],
      confirmLabel: "Clone",
      onConfirm: (v) => {
        // Empty means "whatever git would have called it", which is the same
        // rule `git clone` follows when given no directory.
        const name = v.name.trim() || repoNameFromUrl(v.url);
        if (!name) {
          activity.note(
            "Clone",
            `Could not work out a folder name from ${v.url}. Give one explicitly.`,
            "error",
          );
          return;
        }

        const path = cloneDestination(v.parent, name);

        void perform(`Clone ${name}`, async () => {
          try {
            const repo = await api.cloneRepo(v.url, path);
            await queryClient.invalidateQueries({ queryKey: ["repos"] });
            setActiveId(repo.id);
            return `Cloned into ${repo.root}`;
          } finally {
            // Whether it worked or failed, nothing is cloning any more.
            setCloning(null);
          }
        });
      },
    });

  /** Both ways in, from one place, so the tab strip and the welcome screen
   *  cannot drift apart. */
  const openAddRepoMenu = (event: React.MouseEvent) =>
    openMenu(event, [
      {
        label: "Open existing repository…",
        hint: shortcutLabel(keymap["repo.open"]),
        onClick: () => void openRepo(),
      },
      {
        label: "Create new repository…",
        hint: shortcutLabel(keymap["repo.create"]),
        onClick: createRepo,
      },
      {
        label: "Clone from a URL…",
        hint: shortcutLabel(keymap["repo.clone"]),
        onClick: cloneRepo,
      },
      "separator",
      // Below the line because it is not another way to add one: it is the
      // list of the ones already added, which is usually what you want when
      // the repository you are after is one you have opened before.
      {
        label: "All repositories…",
        hint: shortcutLabel(keymap["repo.library"]),
        onClick: openLibraryTab,
      },
    ]);

  const reorderTabs = (from: number, to: number) =>
    setTabOrder(moveItem(tabs.map((repo) => repo.id), from, to));

  /** Shift the tab you are on one place, and stop at the ends rather than
   *  wrapping: a rearrangement that jumps a tab from one end to the other is
   *  almost never what a nudge meant. */
  const moveActiveTab = (step: number) => {
    const from = tabs.findIndex((repo) => repo.id === activeId);
    if (from === -1) return;

    const to = Math.min(Math.max(from + step, 0), tabs.length - 1);
    reorderTabs(from, to);
  };

  /** Tabs are listed in the order the strip shows them, so an index here is
   *  the position you can actually see. */
  const goToTab = (index: number) => {
    const repo = tabs[index];
    if (repo) setActiveId(repo.id);
  };

  /** The digit that selects a tab, or null for one no digit reaches.
   *
   *  Past the eighth tab only the last is addressable, on 9 — so that is the
   *  only one still worth labelling. */
  const tabDigit = (index: number): number | null => {
    if (index < 8) return index + 1;
    return index === tabs.length - 1 ? 9 : null;
  };

  /** Wraps, so Ctrl+Tab keeps cycling rather than stopping at the last one. */
  const cycleTab = (delta: number) => {
    const list = tabs;
    if (list.length < 2) return;

    const current = list.findIndex((repo) => repo.id === activeId);
    const next = (current + delta + list.length) % list.length;
    setActiveId(list[next].id);
  };

  const closeRepo = async (repoId: string) => {
    // The list is a tab but not a repository: closing it puts it away rather
    // than asking the backend to drop a session it never had.
    if (repoId === LIBRARY_TAB) {
      setLibraryOpen(false);
      if (activeId === LIBRARY_TAB) setActiveId(repoTabs[0]?.id ?? null);
      return;
    }

    await api.closeRepo(repoId);
    await queryClient.invalidateQueries({ queryKey: ["repos"] });
    if (activeId === repoId) {
      setActiveId(tabs.find((r) => r.id !== repoId)?.id ?? null);
    }
  };

  // --- dialogs ------------------------------------------------------------

  const openAddWorktree = () => {
    if (!id) return;

    const branches = refs.data?.branches ?? [];
    const existing = new Set(branches.map((branch) => branch.name));

    // A branch can only be checked out in one worktree at a time, so saying
    // where each one already is turns a guaranteed git error into something
    // visible before the button is pressed.
    const occupied = new Map(
      (worktrees.data ?? [])
        .filter((tree) => tree.branch)
        .map((tree) => [tree.branch as string, tree.path]),
    );

    setDialog({
      title: "Add worktree",
      message:
        "A worktree checks out another branch into its own directory, so you can work on two branches without stashing.",
      fields: [
        {
          key: "path",
          label: "Location",
          browse: true,
          placeholder: `${activeRepo?.root ?? ""}-feature`,
        },
        {
          key: "branch",
          label: "Branch",
          placeholder: "feature/login",
          options: branches.map((branch) => ({
            value: branch.name,
            note: occupied.has(branch.name)
              ? "in use"
              : branch.isHead
                ? "current"
                : undefined,
          })),
          // Whether this creates a branch is a fact about what was typed, not
          // a separate thing to get wrong: the checkbox that used to ask left
          // "create" ticked against an existing name, which git rejects.
          describe: (value) => {
            const name = value.trim();
            if (name === "") return undefined;
            if (!existing.has(name)) return `Creates ${name} from the current HEAD.`;

            const where = occupied.get(name);
            return where
              ? `${name} is already checked out in ${where}, so this will fail.`
              : `Checks out the existing branch ${name}.`;
          },
        },
      ],
      confirmLabel: "Add worktree",
      onConfirm: (v) =>
        act(`Add worktree ${v.branch}`, () =>
          api.addWorktree(id, v.path, v.branch, !existing.has(v.branch)),
        ),
    });
  };

  const openUpdateSubmodules = () => {
    if (!id) return;

    setDialog({
      title: "Update submodules",
      message: "Initializes any missing submodule and checks out the recorded commit.",
      checkboxes: [
        { key: "recursive", label: "Recurse into nested submodules", value: true },
      ],
      confirmLabel: "Update",
      onConfirm: (v) =>
        act("Update submodules", () =>
          api.updateSubmodules(id, "", v.recursive === "true"),
        ),
    });
  };

  const confirmDeleteBranch = (branch: BranchRef) => {
    if (!id) return;

    const name = branch.name;
    const up = splitUpstream(branch.upstream);

    setDialog({
      title: `Delete branch ${name}`,
      message: up
        ? `${name} also exists on ${up.remote}. Deleting it here leaves the remote copy; deleting it there removes it for everyone.`
        : "Git refuses to delete a branch whose work is not merged anywhere. Forcing overrides that check and the commits become unreachable.",
      checkboxes: [
        { key: "local", label: `Delete the local branch`, value: true },
        // Only offered where there is one. Both boxes together are lazygit's
        // "local and remote"; either alone is one of the other two.
        ...(up
          ? [{ key: "remote", label: `Delete ${branch.upstream} as well`, value: false }]
          : []),
        { key: "force", label: "Force delete even if unmerged", value: false },
      ],
      confirmLabel: "Delete",
      danger: true,
      onConfirm: (v) => {
        const local = v.local === "true";
        const remote = v.remote === "true" && up !== null;

        if (!local && !remote) {
          activity.note("Delete branch", "Nothing was selected to delete.", "error");
          return;
        }

        void perform(`Delete ${name}`, async () => {
          const done: string[] = [];

          // Local first, deliberately. It is the one git will refuse if the
          // work is unmerged, and that refusal should stop the whole thing
          // rather than arrive after the remote copy is already gone.
          if (local) {
            await api.deleteBranch(id, name, v.force === "true");
            done.push(`Deleted ${name}`);
          }

          if (remote && up) {
            await api.deleteRemoteBranch(id, up.remote, up.branch);
            done.push(`Deleted ${up.remote}/${up.branch}`);
          }

          return done.join(" · ");
        });
      },
    });
  };

  // --- git flow -----------------------------------------------------------

  const openFlowSetup = () => {
    if (!id) return;
    const config = flow.data?.config;
    const existing = flow.data?.initialized ?? false;

    setDialog({
      title: existing ? "Git flow settings" : "Set up git flow",
      message:
        "Branch names and prefixes are stored in this repository's git config, so the git-flow command line tool reads the same setup.",
      fields: [
        { key: "master", label: "Production branch", value: config?.master ?? "main" },
        { key: "develop", label: "Development branch", value: config?.develop ?? "develop" },
        { key: "feature", label: "Feature prefix", value: config?.feature ?? "feature/" },
        { key: "bugfix", label: "Bugfix prefix", value: config?.bugfix ?? "bugfix/" },
        { key: "release", label: "Release prefix", value: config?.release ?? "release/" },
        { key: "hotfix", label: "Hotfix prefix", value: config?.hotfix ?? "hotfix/" },
        { key: "support", label: "Support prefix", value: config?.support ?? "support/" },
        {
          key: "versiontag",
          label: "Version tag prefix",
          value: config?.versiontag ?? "",
          placeholder: "v",
          optional: true,
        },
      ],
      confirmLabel: existing ? "Save settings" : "Set up git flow",
      onConfirm: (v) =>
        act(existing ? "Save git flow settings" : "Set up git flow", () =>
          api.flowInit(id, {
            master: v.master,
            develop: v.develop,
            feature: v.feature,
            bugfix: v.bugfix,
            release: v.release,
            hotfix: v.hotfix,
            support: v.support,
            versiontag: v.versiontag,
          }),
        ),
    });
  };

  const openFlowStart = (kind: FlowKind) => {
    if (!id) return;
    const config = flow.data?.config;
    const base = kind === "hotfix" || kind === "support" ? config?.master : config?.develop;
    const versioned = isReleaseKind(kind);

    setDialog({
      title: `Start ${flowNoun[kind]}`,
      message: `Branches from ${base ?? "the base branch"} and checks the new branch out.`,
      fields: [
        {
          key: "name",
          label: versioned ? "Version" : "Name",
          placeholder: versioned ? "1.4.0" : "login",
        },
      ],
      confirmLabel: "Start",
      onConfirm: (v) =>
        act(`Start ${flowNoun[kind]} ${v.name}`, () => api.flowStart(id, kind, v.name)),
    });
  };

  const openFlowFinish = (current: CurrentFlow) => {
    if (!id) return;
    const config = flow.data?.config;
    const versioned = isReleaseKind(current.kind);

    // What the merges will do, drawn. Two merges, a tag and a delete is more
    // than a sentence carries comfortably, and it is the moment to check.
    const targets: FlowPlanTarget[] = versioned
      ? [
          {
            branch: config?.master ?? "main",
            tag: `${config?.versiontag ?? ""}${current.name}`,
          },
          { branch: config?.develop ?? "develop" },
        ]
      : [{ branch: config?.develop ?? "develop" }];

    setDialog({
      title: `Finish ${flowNoun[current.kind]} ${current.name}`,
      message: versioned
        ? `Merges ${current.branch} into ${config?.master}, tags the result, then merges it into ${config?.develop}.`
        : `Merges ${current.branch} into ${config?.develop}.`,
      graphic: <FlowPlan from={current.branch} targets={targets} />,
      fields: versioned
        ? [
            {
              key: "tagMessage",
              label: "Tag message",
              placeholder: `${config?.versiontag ?? ""}${current.name}`,
              optional: true,
            },
          ]
        : undefined,
      checkboxes: [
        // Only where there is a tag to skip: git flow never tags a feature.
        ...(versioned
          ? [
              {
                key: "tag",
                label: `Tag ${config?.versiontag ?? ""}${current.name}`,
                value: true,
              },
            ]
          : []),
        { key: "delete", label: `Delete ${current.branch} afterwards`, value: true },
        // git refuses to delete a branch it thinks is unmerged, which after
        // the merges above should not happen -- and occasionally does, when
        // the merge was resolved in a way git cannot see as containing it.
        { key: "force", label: "Delete it even if git says it is unmerged" },
        { key: "push", label: "Push the result to origin" },
      ],
      confirmLabel: "Finish",
      onConfirm: (v) =>
        act(`Finish ${flowNoun[current.kind]} ${current.name}`, () =>
          api.flowFinish(id, current.kind, current.name, {
            deleteBranch: v.delete === "true",
            forceDelete: v.force === "true",
            push: v.push === "true",
            // A feature has no tag box, and git flow would not tag it anyway.
            tag: !versioned || v.tag === "true",
            tagMessage: v.tagMessage ?? "",
          }),
        ),
    });
  };

  const openFlowMenu = (x: number, y: number) => {
    const status = flow.data;

    // Nothing is configured yet, so there is exactly one thing to offer.
    if (!status?.initialized) {
      openMenuAt(x, y, [{ label: "Set up git flow…", onClick: openFlowSetup }]);
      return;
    }

    const entries: MenuEntry[] = [];

    // Finishing only makes sense on a flow branch, so it leads the menu when
    // you are on one and is absent when you are not.
    if (status.current && status.current.kind !== "support") {
      const { kind, name } = status.current;
      entries.push(
        { label: `Finish ${flowNoun[kind]} ${name}…`, onClick: () => openFlowFinish(status.current!) },
        "separator",
      );
    }

    entries.push(
      { label: "Start feature…", onClick: () => openFlowStart("feature") },
      { label: "Start bugfix…", onClick: () => openFlowStart("bugfix") },
      { label: "Start release…", onClick: () => openFlowStart("release") },
      { label: "Start hotfix…", onClick: () => openFlowStart("hotfix") },
      "separator",
      { label: "Git flow settings…", onClick: openFlowSetup },
    );

    openMenuAt(x, y, entries);
  };

  /** Every ref you could name: local branches first, then remote-tracking
   *  branches, then tags. Used wherever the answer is "a place in history". */
  const refOptions = ({ includeCurrent = true } = {}): ComboOption[] => [
    ...(refs.data?.branches ?? [])
      .filter((branch) => includeCurrent || !branch.isHead)
      .map((branch) => ({
        value: branch.name,
        note: branch.isHead ? "current" : undefined,
      })),
    ...(refs.data?.remotes ?? []).flatMap((remote) =>
      remote.branches.map((branch) => ({
        value: `${remote.name}/${branch}`,
        note: remote.name,
      })),
    ),
    ...(refs.data?.tags ?? []).map((tag) => ({ value: tag, note: "tag" })),
  ];

  const openNewBranch = (from?: string) => {
    const current = head?.head ?? "HEAD";

    setDialog({
      title: "New branch",
      fields: [
        { key: "name", label: "Branch name", placeholder: "feature/thing" },
        {
          key: "base",
          label: "Starting from",
          // Defaults to where you are, which is what git does when no start
          // point is given -- and what you want often enough that the field is
          // there to be ignored as much as used. A menu on a commit or tag
          // passes that instead.
          value: from ?? current,
          placeholder: current,
          optional: true,
          options: refOptions(),
          describe: (value) => {
            const base = value.trim();
            if (base === "" || base === current) return undefined;

            // Worth saying: branching from somewhere you are not is the case
            // where the result surprises people.
            return `Branches from ${base}, not from ${current}.`;
          },
        },
      ],
      checkboxes: [{ key: "checkout", label: "Check it out afterwards", value: true }],
      confirmLabel: "Create branch",
      onConfirm: (v) =>
        act(`Create branch ${v.name}`, () =>
          api.createBranch(id!, v.name, v.checkout === "true", v.base || null),
        ),
    });
  };

  /** `origin` where there is one, else the first remote. For actions that
   *  name a remote without asking. */
  const preferredRemote = (): string | undefined => {
    const remotes = refs.data?.remotes ?? [];
    return (remotes.find((r) => r.name === "origin") ?? remotes[0])?.name;
  };

  const remoteBranchOptions = (): ComboOption[] =>
    (refs.data?.remotes ?? []).flatMap((remote) =>
      remote.branches.map((branch) => ({ value: `${remote.name}/${branch}`, note: remote.name })),
    );

  const openNewRemote = () =>
    setDialog({
      title: "Add remote",
      fields: [
        {
          key: "name",
          label: "Name",
          placeholder: "origin",
          // The first remote is nearly always origin; a second one is not.
          value: (refs.data?.remotes.length ?? 0) === 0 ? "origin" : "",
        },
        { key: "url", label: "URL", placeholder: "git@github.com:you/repo.git" },
      ],
      confirmLabel: "Add remote",
      onConfirm: (v) =>
        act(`Add remote ${v.name}`, () => api.addRemote(id!, v.name.trim(), v.url.trim())),
    });

  const openEditRemote = (remote: RemoteGroup) =>
    setDialog({
      title: `Edit remote ${remote.name}`,
      fields: [
        { key: "name", label: "Name", value: remote.name },
        { key: "url", label: "URL", value: remote.url },
      ],
      confirmLabel: "Save",
      onConfirm: (v) =>
        act(`Edit remote ${remote.name}`, async () => {
          const name = v.name.trim();
          const url = v.url.trim();
          const done: string[] = [];

          // URL first, under the old name: a rename that then failed would
          // otherwise leave the URL change addressed to a remote that no
          // longer exists.
          if (url !== remote.url) {
            await api.setRemoteUrl(id!, remote.name, url);
            done.push(`URL is now ${url}`);
          }
          if (name !== remote.name) {
            await api.renameRemote(id!, remote.name, name);
            done.push(`Renamed to ${name}`);
          }

          return done.join(" · ") || "Nothing changed";
        }),
    });

  const confirmRemoveRemote = (remote: RemoteGroup) =>
    setDialog({
      title: `Remove remote ${remote.name}`,
      message: `Forgets ${remote.url || remote.name} and every ${remote.name}/… branch fetched from it. Nothing on the remote itself changes.`,
      confirmLabel: "Remove",
      danger: true,
      onConfirm: () =>
        act(`Remove remote ${remote.name}`, () => api.removeRemote(id!, remote.name)),
    });

  const openNewTag = (at?: string) => {
    const current = head?.head ?? "HEAD";

    setDialog({
      title: "New tag",
      fields: [
        { key: "name", label: "Tag name", placeholder: "v1.2.0" },
        {
          key: "target",
          label: "At",
          value: at ?? current,
          placeholder: current,
          optional: true,
          options: refOptions(),
        },
        {
          key: "message",
          label: "Message",
          placeholder: "Empty for a lightweight tag",
          optional: true,
          describe: (value) =>
            value.trim() === ""
              ? "A lightweight tag: a name for a commit, nothing more."
              : "An annotated tag, with an author, a date and this message.",
        },
      ],
      confirmLabel: "Create tag",
      onConfirm: (v) =>
        act(`Tag ${v.name}`, () => api.createTag(id!, v.name.trim(), v.target, v.message)),
    });
  };

  const confirmDeleteTag = (tag: string) => {
    const remote = preferredRemote();

    setDialog({
      title: `Delete tag ${tag}`,
      message: remote
        ? `Deleting it here leaves the copy on ${remote}; deleting it there removes it for everyone.`
        : "Git keeps no record of a deleted tag.",
      checkboxes: remote
        ? [{ key: "remote", label: `Delete it on ${remote} as well`, value: false }]
        : [],
      confirmLabel: "Delete",
      danger: true,
      onConfirm: (v) =>
        act(`Delete tag ${tag}`, () =>
          api.deleteTag(id!, tag, v.remote === "true" && remote ? remote : null),
        ),
    });
  };

  const pushTag = (tag: string) => {
    const remote = preferredRemote();
    if (!remote) {
      activity.note("Push tag", "This repository has no remote to push to.", "error");
      return;
    }
    act(`Push ${tag} to ${remote}`, () => api.pushTag(id!, tag, remote), "push");
  };

  const openRenameBranch = (branch: BranchRef) =>
    setDialog({
      title: `Rename ${branch.name}`,
      fields: [{ key: "name", label: "New name", value: branch.name }],
      confirmLabel: "Rename",
      onConfirm: (v) =>
        act(`Rename ${branch.name} to ${v.name}`, () =>
          api.renameBranch(id!, branch.name, v.name.trim()),
        ),
    });

  const openSetUpstream = (branch: BranchRef) =>
    setDialog({
      title: `Upstream for ${branch.name}`,
      message: "The remote branch Pull takes from and Push sends to.",
      fields: [
        {
          key: "upstream",
          label: "Upstream",
          value: branch.upstream ?? "",
          placeholder: "origin/main",
          options: remoteBranchOptions(),
        },
      ],
      confirmLabel: "Set upstream",
      onConfirm: (v) =>
        act(`Track ${v.upstream} with ${branch.name}`, () =>
          api.setUpstream(id!, branch.name, v.upstream.trim()),
        ),
    });

  const confirmForceCheckout = (name: string) =>
    setDialog({
      title: `Check out ${name}, discarding local changes`,
      message:
        "Uncommitted changes to tracked files are thrown away first. Git keeps no record of them.",
      confirmLabel: "Discard and check out",
      danger: true,
      onConfirm: () => act(`Check out ${name}`, () => api.checkout(id!, name, true)),
    });

  const openCheckoutByName = () =>
    setDialog({
      title: "Check out",
      fields: [
        {
          key: "ref",
          label: "Branch, tag or commit",
          placeholder: "main, v1.0, abc1234",
          options: refOptions({ includeCurrent: false }),
        },
      ],
      confirmLabel: "Check out",
      onConfirm: (v) => act(`Check out ${v.ref}`, () => api.checkout(id!, v.ref.trim())),
    });

  /** Undo, said out loud before it happens: what moved HEAD, and where it
   *  goes back to. The reflog is what makes this possible, and the dialog
   *  quotes it so the answer is never a surprise. */
  const confirmUndo = () => {
    const [last, before] = reflogQuery.data ?? [];
    if (!last || !before) {
      activity.note("Undo", "Nothing to undo: HEAD has not moved yet.", "error");
      return;
    }

    const checkout = last.subject.startsWith("checkout: moving from ");
    setDialog({
      title: "Undo",
      message: checkout
        ? `${last.subject}.\n\nGoes back to the branch you came from.`
        : `${last.subject}.\n\n${head?.head ?? "HEAD"} moves back to ${before.short}, hard. Uncommitted changes to tracked files would go with it, so this refuses while there are any.`,
      confirmLabel: "Undo",
      danger: !checkout,
      onConfirm: () => act("Undo", () => api.undo(id!)),
    });
  };

  const confirmForcePush = () =>
    setDialog({
      title: `Force push ${head?.head ?? "HEAD"}`,
      message:
        "Rewrites the remote branch to match this one. With a lease, git refuses if the remote has moved since your last fetch, so nobody else's work is overwritten unseen.",
      confirmLabel: "Force push",
      danger: true,
      onConfirm: () => act("Force push", () => api.push(id!, true, false), "push"),
    });

  /** The branch the sidebar cursor is on, if it is on one.
   *
   *  Merge is a global key, so it fires wherever you are. Having walked to a
   *  branch and pressed it, the branch you are looking at is the one you mean —
   *  opening an empty box and asking would be the app pretending not to know. */
  const cursorRef = () => {
    if (!isSidebarPanel(focusedPanel) || !sidebarCursor) return "";

    switch (sidebarCursor.kind) {
      case "branch":
        return sidebarCursor.branch.isHead ? "" : sidebarCursor.branch.name;
      case "remote":
        return `${sidebarCursor.remote}/${sidebarCursor.branch}`;
      case "tag":
        return sidebarCursor.tag;
      default:
        return "";
    }
  };

  const openMerge = () => {
    const current = head?.head ?? "HEAD";

    setDialog({
      title: `Merge into ${current}`,
      fields: [
        {
          key: "name",
          label: "Branch to merge",
          value: cursorRef(),
          placeholder: "main",
          options: refOptions({ includeCurrent: false }),
          describe: (value) =>
            value.trim() === "" ? undefined : `Merges ${value.trim()} into ${current}.`,
        },
      ],
      confirmLabel: "Merge",
      onConfirm: (v) => act(`Merge ${v.name}`, () => api.mergeBranch(id!, v.name)),
    });
  };

  /** Everything a discard would throw away. */
  const discardablePaths = () =>
    head?.entries
      .filter((e) => e.worktreeStatus !== "." || e.kind === "untracked")
      .filter((e) => e.kind !== "ignored")
      .map((e) => e.path) ?? [];

  const openStash = () =>
    setDialog({
      title: "Stash changes",
      fields: [
        {
          key: "message",
          label: "Message",
          placeholder: "work in progress",
          optional: true,
        },
      ],
      checkboxes: [
        { key: "untracked", label: "Include untracked files", value: true },
        { key: "staged", label: "Only what is staged", value: false },
        { key: "keepIndex", label: "Leave staged changes in place as well", value: false },
      ],
      confirmLabel: "Stash",
      onConfirm: (v) =>
        act("Stash changes", () =>
          api.stashPush(
            id!,
            v.message,
            v.untracked === "true",
            v.staged === "true",
            v.keepIndex === "true",
          ),
        ),
    });

  /** Take the next step a failed command suggested. */
  const runHintAction = (kind: HintAction) => {
    if (!id) return;

    switch (kind) {
      case "pull":
        act("Pull", () => api.pull(id));
        break;
      case "fetch":
        act("Fetch", () => api.fetch(id));
        break;
      case "stash":
        openStash();
        break;
      case "resolve":
        // The conflicted files are in the File Status view; put the user there
        // rather than describing where to go.
        setView("status");
        break;
    }
  };

  const confirmDiscard = (paths: string[]) => {
    if (!id || paths.length === 0) return;

    const what = paths.length === 1 ? paths[0] : `${paths.length} files`;

    // Turning the confirmation off is a deliberate setting, so it is honoured
    // rather than asking anyway.
    if (!settings.confirmDiscard) {
      act(`Discard ${what}`, () => api.discard(id, paths));
      return;
    }

    setDialog({
      title: `Discard changes to ${what}`,
      message:
        "The working copy goes back to the last commit. Git keeps no record of discarded changes, so this cannot be undone.",
      confirmLabel: "Discard",
      danger: true,
      onConfirm: () =>
        act(`Discard ${what}`, () => api.discard(id, paths)),
    });
  };

  /** Dropping a stash cannot be undone in any way a user would find, and the
   *  keyboard path is a single keystroke. The menu entry stays direct: getting
   *  there is already two deliberate steps. */
  const confirmDropStash = (selector: string, message: string) => {
    if (!id) return;

    setDialog({
      title: `Drop ${selector}`,
      message: `${message}

The stashed changes are discarded.`,
      confirmLabel: "Drop",
      danger: true,
      onConfirm: () => act(`Drop ${selector}`, () => api.stashDrop(id, selector)),
    });
  };

  const confirmRemoveWorktree = (path: string) => {
    if (!id) return;

    setDialog({
      title: "Remove worktree",
      message: `${path}\n\nThe directory is deleted. Uncommitted changes in it are lost.`,
      checkboxes: [{ key: "force", label: "Force removal even with uncommitted changes" }],
      confirmLabel: "Remove",
      danger: true,
      onConfirm: (v) =>
        act("Remove worktree", () => api.removeWorktree(id, path, v.force === "true")),
    });
  };

  // --- menus --------------------------------------------------------------

  /** Reset the current branch to a commit, once the cost is known.
   *
   *  The impact is fetched before the question is asked rather than after it is
   *  answered: "3 commits will be dropped, 2 of which origin/main already has"
   *  is the whole basis for deciding, and a confirmation that only repeats the
   *  verb is one people learn to click through.
   */
  const confirmReset = async (commit: Pick<Commit, "oid" | "short">, mode: ResetMode) => {
    if (!id) return;

    const impact = await api.resetImpact(id, commit.oid);
    const branch = head?.head ?? "HEAD";

    const dropped =
      impact.dropped === 1 ? "1 commit" : `${impact.dropped} commits`;

    const explain: Record<ResetMode, string> = {
      soft: `${branch} moves back past ${dropped}. Their changes stay staged, ready to commit again.`,
      mixed: `${branch} moves back past ${dropped}. Their changes stay in your files, unstaged.`,
      hard: `${branch} moves back past ${dropped}, and their changes go with them. Anything not committed elsewhere cannot be recovered.`,
    };

    const what = explain[mode];

    // The published case is the one worth interrupting for: the commits are on
    // a branch other people pull, so this is a rewrite rather than a local
    // tidy-up, and putting it back needs a force push.
    const warning =
      impact.published > 0
        ? ` ${impact.published} of them ${impact.published === 1 ? "is" : "are"} already on ${impact.upstream}. Anyone who has pulled will still have ${impact.published === 1 ? "it" : "them"}, and pushing this will need forcing.`
        : "";

    setDialog({
      title: `Reset ${branch} to ${commit.short}`,
      message: `${what}${warning}`,
      graphic: undefined,
      confirmLabel: mode === "hard" ? "Reset and discard" : "Reset",
      danger: mode === "hard" || impact.published > 0,
      onConfirm: () =>
        act(`Reset ${branch} to ${commit.short}`, () =>
          api.resetTo(id, commit.oid, mode),
        ),
    });
  };

  /** Take a commit out of the branch entirely.
   *
   *  Everything after it is replayed, so this rewrites history exactly as a
   *  reset does -- and earns the same warning when any of it is published.
   */
  const confirmDrop = async (commit: Commit) => {
    if (!id) return;

    const impact = await api.dropImpact(id, commit.oid);
    const after = impact.dropped - 1;

    const replayed =
      after === 0
        ? "It is the newest commit, so nothing has to be replayed."
        : `The ${after === 1 ? "commit" : `${after} commits`} after it will be replayed and get new hashes.`;

    const warning =
      impact.published > 0
        ? ` ${impact.published} of them ${impact.published === 1 ? "is" : "are"} already on ${impact.upstream}, so this rewrites history other people have.`
        : "";

    setDialog({
      title: `Drop ${commit.short}`,
      message: `Removes "${commit.subject}" from the branch. ${replayed}${warning} A conflict will stop the replay part way, like any rebase.`,
      confirmLabel: "Drop",
      danger: true,
      onConfirm: () =>
        act(`Drop ${commit.short}`, () => api.dropCommit(id, commit.oid)),
    });
  };

  const confirmRevert = (commit: Commit) => {
    if (!id) return;

    setDialog({
      title: `Revert ${commit.short}`,
      message:
        "Makes a new commit that undoes this one. History is added to rather than rewritten, so this is the safe way to undo something other people already have.",
      confirmLabel: "Revert",
      onConfirm: () =>
        act(`Revert ${commit.short}`, () => api.revertCommit(id, commit.oid)),
    });
  };

  /** Where a remote's repository lives on the web, if it can be told. */
  const hostingFor = (remote?: string | null): Hosting | null => {
    const name = remote ?? preferredRemote();
    const url = refs.data?.remotes.find((r) => r.name === name)?.url;
    return url ? hostingOf(url) : null;
  };

  const browse = (url: string) => {
    void openUrl(url).catch((error: unknown) =>
      activity.note("Open in browser", messageOf(error), "error"),
    );
  };

  /** The bisect choices for a commit: the two ends first, then, once a
   *  bisect runs, skip and stop. */
  const bisectEntries = (commit: Pick<Commit, "oid" | "short">): MenuEntry[] => {
    if (!id) return [];
    const running = bisect.data?.active ?? false;
    const mark = (verdict: BisectVerdict) =>
      act(`Bisect: ${commit.short} is ${verdict === "skip" ? "skipped" : verdict}`, () =>
        api.bisectMark(id, verdict, commit.oid),
      );

    return [
      {
        label: running ? `Mark ${commit.short} bad` : `Start bisect: ${commit.short} is bad`,
        onClick: () => mark("bad"),
      },
      {
        label: running ? `Mark ${commit.short} good` : `Start bisect: ${commit.short} is good`,
        onClick: () => mark("good"),
      },
      ...(running
        ? [
            { label: `Skip ${commit.short}`, onClick: () => mark("skip") },
            {
              label: "Stop bisect and go back",
              onClick: () => act("Stop bisect", () => api.bisectReset(id)),
            },
          ]
        : []),
    ];
  };

  /** What every custom command can refer to, whatever it is about. */
  const baseVars = (): Record<string, string> => ({
    repo: activeRepo?.root ?? "",
    head: head?.head ?? "",
  });

  /** Run one of the user's own commands: ask its questions first, if it has
   *  any, then fill the line and run it in the repository. */
  const runCustom = (command: CustomCommand, vars: Record<string, string>) => {
    if (!id) return;
    const all = { ...baseVars(), ...vars };

    const go = (answers: Record<string, string>) => {
      const withAnswers = { ...all };
      for (const [key, value] of Object.entries(answers)) withAnswers[`prompt.${key}`] = value;
      const line = fill(command.command, withAnswers);
      act(command.label, () => api.runShell(id, line));
    };

    if (!command.prompts?.length && !command.confirm) {
      go({});
      return;
    }

    setDialog({
      title: command.label,
      message: command.confirm ? fill(command.confirm, all) : undefined,
      fields: (command.prompts ?? []).map((prompt) => ({
        key: prompt.key,
        label: prompt.label,
        value: fill(prompt.value ?? "", all),
        optional: true,
        options: prompt.options?.map((value) => ({ value })),
      })),
      confirmLabel: "Run",
      onConfirm: go,
    });
  };

  /** The user's commands for a context, as menu entries after a separator,
   *  or nothing when there are none. */
  const customEntries = (context: CustomContext, vars: Record<string, string>): MenuEntry[] => {
    const own = settings.customCommands.filter((command) => command.context === context);
    if (own.length === 0) return [];
    return [
      "separator",
      ...own.map((command) => ({
        label: command.label,
        onClick: () => runCustom(command, vars),
      })),
    ];
  };

  /** Global custom commands, in the palette's shape. */
  const customGlobals: CommandDef[] = settings.customCommands.flatMap((command, index) =>
    command.context === "global"
      ? [
          {
            id: customId(index),
            label: command.label,
            category: "Custom",
            scope: "global" as const,
            binding: command.key ? [command.key] : [],
            needsRepo: true,
          },
        ]
      : [],
  );

  /** Plan an interactive rebase of everything from `from` to HEAD, with one
   *  commit's action already chosen when a menu entry named it. */
  const openRebase = async (from: string, preset?: { oid: string; action: RebaseAction }) => {
    if (!id) return;
    try {
      setRebase({ plan: await api.rebasePlan(id, from), preset });
    } catch (error) {
      activity.note("Rebase", messageOf(error), "error");
    }
  };

  /** Right-click on a commit in the history. */
  const openCommitMenu = (commit: Commit, at: { x: number; y: number }) => {
    const branch = head?.head;
    // Nothing here can move a branch that is not checked out.
    const detached = !branch;

    openMenuAt(at.x, at.y, [
      {
        label: "Copy hash",
        onClick: () => void copy(commit.oid, commit.oid, commit.short),
      },
      {
        label: "Copy subject",
        onClick: () => void copy(`subject:${commit.oid}`, commit.subject),
      },
      {
        label: "Copy author",
        onClick: () =>
          void copy(`author:${commit.oid}`, `${commit.author} <${commit.email}>`),
      },
      "separator",
      {
        label: `Cherry-pick ${commit.short} onto ${branch ?? "HEAD"}`,
        onClick: () =>
          act(`Cherry-pick ${commit.short}`, () => api.cherryPick(id!, commit.oid)),
      },
      {
        label: `Check out ${commit.short} (detached)`,
        onClick: () => act(`Check out ${commit.short}`, () => api.checkout(id!, commit.oid)),
      },
      { label: `New branch from ${commit.short}…`, onClick: () => openNewBranch(commit.oid) },
      { label: `Tag ${commit.short}…`, onClick: () => openNewTag(commit.oid) },
      "separator",
      {
        label: `Revert ${commit.short}…`,
        onClick: () => confirmRevert(commit),
      },
      {
        label: `Drop ${commit.short}…`,
        // A merge has two histories behind it, so "without this commit" does
        // not name one; the backend refuses, and so does the menu.
        disabled: detached || commit.parents.length !== 1,
        danger: true,
        onClick: () => void confirmDrop(commit),
      },
      "separator",
      {
        label: `Rebase interactively from ${commit.short}…`,
        disabled: detached,
        onClick: () => void openRebase(commit.oid),
      },
      {
        label: `Reword ${commit.short}…`,
        disabled: detached,
        onClick: () => void openRebase(commit.oid, { oid: commit.oid, action: "reword" }),
      },
      {
        label: `Squash ${commit.short} into its parent…`,
        disabled: detached || commit.parents.length !== 1,
        onClick: () =>
          void openRebase(commit.parents[0]!, { oid: commit.oid, action: "squash" }),
      },
      {
        label: `Amend ${commit.short} with the staged changes`,
        disabled: detached || !head?.stagedCount,
        onClick: () =>
          act(`Amend ${commit.short}`, () => api.amendInto(id!, commit.oid)),
      },
      {
        label: `Fixup ${commit.short} into its parent…`,
        disabled: detached || commit.parents.length !== 1,
        onClick: () =>
          void openRebase(commit.parents[0]!, { oid: commit.oid, action: "fixup" }),
      },
      "separator",
      {
        label: `Reset ${branch ?? "HEAD"} here, keep changes staged…`,
        disabled: detached,
        onClick: () => void confirmReset(commit, "soft"),
      },
      {
        label: `Reset ${branch ?? "HEAD"} here, keep changes…`,
        disabled: detached,
        onClick: () => void confirmReset(commit, "mixed"),
      },
      {
        label: `Reset ${branch ?? "HEAD"} here, discard changes…`,
        disabled: detached,
        danger: true,
        onClick: () => void confirmReset(commit, "hard"),
      },
      "separator",
      ...bisectEntries(commit),
      ...(hostingFor()
        ? [
            "separator" as const,
            {
              label: `Open ${commit.short} on ${hostingFor()!.name}`,
              onClick: () => browse(commitUrl(hostingFor()!, commit.oid)),
            },
          ]
        : []),
      ...customEntries("commit", { commit: commit.oid, short: commit.short, subject: commit.subject }),
    ]);
  };

  /** B on a commit: bisect only. */
  const openBisectMenu = (commit: Commit, at: { x: number; y: number }) =>
    openMenuAt(at.x, at.y, bisectEntries(commit));

  const openMenuAt = (x: number, y: number, entries: MenuEntry[]) =>
    setMenu({ x, y, entries });

  const openMenu = (event: React.MouseEvent, entries: MenuEntry[]) =>
    openMenuAt(event.clientX, event.clientY, entries);

  /** Where a menu opens when it was triggered by a key rather than a click. */
  const menuAnchor = (): [number, number] => [window.innerWidth / 2 - 100, 120];

  const blameFile = (path: string, rev: string | null = null) =>
    setBlameTarget({ path, rev });

  /** Menu for a row in the File Status lists. */
  const onFileMenu = (
    entry: StatusEntry,
    staged: boolean,
    at: Point,
  ) => {
    if (!id) return;

    openMenuAt(at.x, at.y, [
      staged
        ? {
            label: "Unstage",
            onClick: () => act(stageLabel("Unstage", [entry.path]), () => api.unstage(id, [entry.path])),
          }
        : {
            label: "Stage",
            onClick: () => act(stageLabel("Stage", [entry.path]), () => api.stage(id, [entry.path])),
          },
      {
        label: "Blame…",
        // An untracked file has no history to attribute, so blaming one would
        // only ever report the same "not committed yet" for every line.
        disabled: entry.kind === "untracked",
        onClick: () => blameFile(entry.path),
      },
      "separator",
      { label: "Open in editor", onClick: () => openFileInEditor(entry.path) },
      { label: "Copy path", onClick: () => void copy(`path:${entry.path}`, entry.path) },
      // A tracked file stays tracked whatever .gitignore says, so for one of
      // those the ignore also drops the tracking, and the label says so.
      ...(entry.kind !== "ignored"
        ? [
            "separator" as const,
            {
              label:
                entry.kind === "untracked" ? "Add to .gitignore" : "Add to .gitignore and stop tracking",
              onClick: () =>
                act(`Ignore ${entry.path}`, () => api.ignorePath(id, entry.path, false)),
            },
            {
              label:
                entry.kind === "untracked"
                  ? "Exclude locally (.git/info/exclude)"
                  : "Exclude locally and stop tracking",
              onClick: () =>
                act(`Exclude ${entry.path}`, () => api.ignorePath(id, entry.path, true)),
            },
          ]
        : []),
      "separator",
      {
        label: "Discard changes…",
        danger: true,
        disabled: staged,
        onClick: () => confirmDiscard([entry.path]),
      },
      ...customEntries("file", { file: entry.path }),
    ]);
  };

  const openFileInEditor = (path: string) => {
    if (!id) return;
    act(`Open ${path}`, () =>
      api.openInEditor(id, settings.editor, settings.editorCommand, settings.terminal, path),
    );
  };

  /** Menu for a file of a commit or stash. */
  const onCommitFileMenu = (path: string, at: Point) =>
    openMenuAt(at.x, at.y, [
      { label: "Open in editor", onClick: () => openFileInEditor(path) },
      { label: "Copy path", onClick: () => void copy(`path:${path}`, path) },
    ]);

  /** Delete whatever the sidebar cursor is on.
   *
   *  Every one of these already had a menu entry; this is the same action
   *  reached by a key. All of them confirm first -- the key is one press, and
   *  none of these are things to lose by leaning on D. */
  /** Delete a remote branch, named as the remote knows it. */
  const confirmDeleteRemoteBranch = (remote: string, branch: string) => {
    if (!id) return;

    setDialog({
      title: `Delete ${remote}/${branch}`,
      message: `This removes the branch from ${remote} for everyone, not just here.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () =>
        act(`Delete ${remote}/${branch}`, () =>
          api.deleteRemoteBranch(id, remote, branch),
        ),
    });
  };

  /** Delete whatever the sidebar cursor is on.
   *
   *  Every path answers, including the ones that cannot act. A key that does
   *  nothing and says nothing reads as a key that is not bound at all, which
   *  is worse than a refusal. */
  /** Edit whatever the sidebar cursor is on: the one thing about it that
   *  has a form, where there is one. */
  const onSidebarEdit = (target: MenuTarget | null) => {
    if (!id) return;

    switch (target?.kind) {
      case "remoteGroup":
        openEditRemote(target.remote);
        break;
      case "branch":
        openRenameBranch(target.branch);
        break;
      default:
        activity.note("Edit", "Nothing here to edit. Move to a remote or a branch first.", "error");
    }
  };

  const onSidebarDelete = (target: MenuTarget | null) => {
    if (!id) return;

    const refuse = (why: string) => activity.note("Delete", why, "error");

    if (!target) {
      refuse("Nothing is selected. Move to a branch, stash or worktree first.");
      return;
    }

    switch (target.kind) {
      case "branch":
        if (target.branch.isHead) {
          refuse(`You are on ${target.branch.name}. Check out another branch to delete this one.`);
          return;
        }
        confirmDeleteBranch(target.branch);
        break;

      case "remote":
        confirmDeleteRemoteBranch(target.remote, target.branch);
        break;

      case "stash":
        confirmDropStash(target.stash.selector, target.stash.message);
        break;

      case "worktree":
        if (target.worktree.isMain) {
          refuse("The main worktree is the repository itself and cannot be removed.");
          return;
        }
        confirmRemoveWorktree(target.worktree.path);
        break;

      case "tag":
        confirmDeleteTag(target.tag);
        break;

      case "remoteGroup":
        confirmRemoveRemote(target.remote);
        break;

      case "submodule":
        refuse("Removing a submodule is not supported yet.");
        break;
    }
  };

  /** Push a branch for the first time and set it to track what it lands on.
   *
   *  With one remote — or an `origin` — there is nothing to ask, so it just
   *  goes. Only a repository with several remotes and no origin has a real
   *  choice in it, and that is the only case that stops to ask. */
  const publishBranch = (name: string) => {
    if (!id) return;

    const remotes = refs.data?.remotes ?? [];
    const obvious =
      remotes.length <= 1 || remotes.some((remote) => remote.name === "origin");

    if (obvious) {
      act(`Publish ${name}`, () => api.publishBranch(id, name, null));
      return;
    }

    setDialog({
      title: `Publish ${name}`,
      message: "This repository has several remotes and no origin, so there is a choice to make.",
      fields: [
        {
          key: "remote",
          label: "Remote",
          value: remotes[0]?.name ?? "",
          options: remotes.map((remote) => ({ value: remote.name })),
          describe: (value) =>
            value.trim() === ""
              ? undefined
              : `Pushes ${name} to ${value.trim()} and tracks it from now on.`,
        },
      ],
      confirmLabel: "Publish",
      onConfirm: (v) => act(`Publish ${name}`, () => api.publishBranch(id, name, v.remote)),
    });
  };

  /** Menus for the sidebar. The sidebar reports what was clicked; the git
   *  meaning of each target is decided here. */
  const onSidebarMenu = (target: MenuTarget, at: Point) => {
    if (!id) return;
    const current = head?.head ?? "HEAD";

    switch (target.kind) {
      case "branch": {
        const { branch } = target;
        openMenuAt(at.x, at.y, [
          {
            label: `Check out ${branch.name}`,
            disabled: branch.isHead,
            onClick: () => act(`Check out ${branch.name}`, () => api.checkout(id, branch.name)),
          },
          // Only where there is nothing to push to yet. Once a branch tracks
          // something, Push is the action and this would be a second name for
          // it.
          ...(branch.upstream
            ? []
            : [
                {
                  label: `Publish ${branch.name}…`,
                  onClick: () => publishBranch(branch.name),
                },
              ]),
          {
            label: `Merge ${branch.name} into ${current}`,
            disabled: branch.isHead,
            onClick: () =>
              act(`Merge ${branch.name}`, () => api.mergeBranch(id, branch.name)),
          },
          {
            label: `Rebase ${current} onto ${branch.name}`,
            disabled: branch.isHead || !head?.head,
            onClick: () =>
              act(`Rebase onto ${branch.name}`, () => api.rebaseBranch(id, branch.name)),
          },
          "separator",
          { label: "Rename…", onClick: () => openRenameBranch(branch) },
          {
            label: branch.upstream ? `Change upstream (${branch.upstream})…` : "Set upstream…",
            onClick: () => openSetUpstream(branch),
          },
          ...(branch.upstream
            ? [
                {
                  label: "Stop tracking upstream",
                  onClick: () =>
                    act(`Untrack ${branch.name}`, () => api.setUpstream(id, branch.name, null)),
                },
              ]
            : []),
          "separator",
          {
            label: `Check out ${branch.name}, discarding local changes…`,
            danger: true,
            disabled: branch.isHead,
            onClick: () => confirmForceCheckout(branch.name),
          },
          {
            label: "Delete branch…",
            danger: true,
            disabled: branch.isHead,
            onClick: () => confirmDeleteBranch(branch),
          },
          ...(() => {
            const hosting = hostingFor(splitUpstream(branch.upstream)?.remote);
            if (!hosting) return [];
            return [
              "separator" as const,
              {
                label: `Open ${branch.name} on ${hosting.name}`,
                onClick: () => browse(branchUrl(hosting, branch.name)),
              },
              {
                label: `Create ${pullRequestNoun(hosting)} from ${branch.name}…`,
                // Nothing to request from until the branch is on the remote.
                disabled: !branch.upstream,
                onClick: () => browse(newPullRequestUrl(hosting, branch.name)),
              },
            ];
          })(),
          ...customEntries("branch", { branch: branch.name }),
        ]);
        break;
      }

      case "remoteGroup": {
        const { remote } = target;
        openMenuAt(at.x, at.y, [
          {
            label: `Fetch ${remote.name}`,
            onClick: () =>
              act(`Fetch ${remote.name}`, () => api.fetchRemote(id, remote.name), "fetch"),
          },
          { label: "Edit…", onClick: () => openEditRemote(remote) },
          "separator",
          { label: "Remove remote…", danger: true, onClick: () => confirmRemoveRemote(remote) },
          ...(hostingOf(remote.url)
            ? [
                {
                  label: `Open on ${hostingOf(remote.url)!.name}`,
                  onClick: () => browse(hostingOf(remote.url)!.web),
                },
              ]
            : []),
          ...customEntries("remote", { remote: remote.name, url: remote.url }),
        ]);
        break;
      }

      case "remote": {
        const { remote, branch } = target;
        openMenuAt(at.x, at.y, [
          {
            label: `Check out ${branch}`,
            onClick: () => act(`Check out ${branch}`, () => api.checkout(id, branch)),
          },
          {
            label: `Merge ${remote}/${branch} into ${current}`,
            onClick: () =>
              act(`Merge ${remote}/${branch}`, () =>
                api.mergeBranch(id, `${remote}/${branch}`),
              ),
          },
          {
            label: `Rebase ${current} onto ${remote}/${branch}`,
            disabled: !head?.head,
            onClick: () =>
              act(`Rebase onto ${remote}/${branch}`, () =>
                api.rebaseBranch(id, `${remote}/${branch}`),
              ),
          },
          "separator",
          { label: "New branch from here…", onClick: () => openNewBranch(`${remote}/${branch}`) },
          {
            label: `Set as upstream of ${current}`,
            disabled: !head?.head,
            onClick: () =>
              act(`Track ${remote}/${branch}`, () =>
                api.setUpstream(id, head!.head!, `${remote}/${branch}`),
              ),
          },
        ]);
        break;
      }

      case "tag":
        openMenuAt(at.x, at.y, [
          {
            // Checking out a tag leaves HEAD detached; git does this, and
            // saying so beats letting the status bar surprise them.
            label: `Check out ${target.tag} (detached)`,
            onClick: () => act(`Check out ${target.tag}`, () => api.checkout(id, target.tag)),
          },
          {
            label: `Merge ${target.tag} into ${current}`,
            onClick: () => act(`Merge ${target.tag}`, () => api.mergeBranch(id, target.tag)),
          },
          { label: "New branch from here…", onClick: () => openNewBranch(target.tag) },
          "separator",
          {
            label: `Push ${target.tag} to ${preferredRemote() ?? "a remote"}`,
            disabled: !preferredRemote(),
            onClick: () => pushTag(target.tag),
          },
          {
            label: "Delete tag…",
            danger: true,
            onClick: () => confirmDeleteTag(target.tag),
          },
          ...customEntries("tag", { tag: target.tag }),
        ]);
        break;

      case "stash": {
        const { selector, message } = target.stash;
        openMenuAt(at.x, at.y, [
          {
            label: "Apply and keep",
            onClick: () => act(`Apply ${selector}`, () => api.stashApply(id, selector, false)),
          },
          {
            label: "Pop (apply and drop)",
            onClick: () => act(`Pop ${selector}`, () => api.stashApply(id, selector, true)),
          },
          "separator",
          {
            label: "Drop",
            danger: true,
            onClick: () =>
              act(`Drop ${selector} — ${message}`, () => api.stashDrop(id, selector)),
          },
          ...customEntries("stash", { stash: selector }),
        ]);
        break;
      }

      case "reflog": {
        const { entry } = target;
        openMenuAt(at.x, at.y, [
          {
            label: `Check out ${entry.short} (detached)`,
            onClick: () => act(`Check out ${entry.short}`, () => api.checkout(id, entry.oid)),
          },
          { label: `New branch from ${entry.short}…`, onClick: () => openNewBranch(entry.oid) },
          {
            label: `Cherry-pick ${entry.short} onto ${current}`,
            onClick: () => act(`Cherry-pick ${entry.short}`, () => api.cherryPick(id, entry.oid)),
          },
          { label: "Copy hash", onClick: () => void copy(entry.oid, entry.oid, entry.short) },
          "separator",
          {
            label: `Reset ${current} here, keep changes staged…`,
            disabled: !head?.head,
            onClick: () => void confirmReset(entry, "soft"),
          },
          {
            label: `Reset ${current} here, keep changes…`,
            disabled: !head?.head,
            onClick: () => void confirmReset(entry, "mixed"),
          },
          {
            label: `Reset ${current} here, discard changes…`,
            disabled: !head?.head,
            danger: true,
            onClick: () => void confirmReset(entry, "hard"),
          },
        ]);
        break;
      }

      case "worktree": {
        const { worktree } = target;
        openMenuAt(at.x, at.y, [
          { label: "Open as tab", onClick: () => void addRepo(worktree.path) },
          "separator",
          worktree.prunable
            ? {
                label: "Prune missing worktrees",
                onClick: () => act("Prune worktrees", () => api.pruneWorktrees(id)),
              }
            : {
                label: "Remove worktree…",
                danger: true,
                disabled: worktree.isMain,
                onClick: () => confirmRemoveWorktree(worktree.path),
              },
        ]);
        break;
      }

      case "submodule": {
        const { submodule } = target;
        openMenuAt(at.x, at.y, [
          {
            label: "Open as tab",
            disabled: submodule.state === "uninitialized",
            onClick: () => void addRepo(absolute(submodule.path, activeRepo?.root)),
          },
          {
            label: submodule.state === "uninitialized" ? "Initialize" : "Update",
            onClick: () =>
              act(`Update ${submodule.path}`, () =>
                api.updateSubmodules(id, submodule.path, true),
              ),
          },
        ]);
        break;
      }
    }
  };

  // --- toolbar ------------------------------------------------------------

  const actions: ToolbarAction[][] = id
    ? [
        [
          {
            key: "commit",
            commandId: "git.commit",
            label: "Commit",
            icon: <IconCommit />,
            badge: head?.stagedCount || undefined,
            primary: (head?.stagedCount ?? 0) > 0,
            onClick: () => {
              setView("status");
              // Defer so the textarea exists if we just switched views.
              setTimeout(() => commitRef.current?.focus(), 0);
            },
          },
          {
            key: "pull",
            commandId: "git.pull",
            label: "Pull",
            icon: <IconPull />,
            badge: head?.behind || undefined,
            onClick: () => act("Pull", () => api.pull(id), "pull"),
            busy: workingOn.has("pull"),
            onContextMenu: (e) =>
              openMenu(e, [
                {
                  label: "Pull with rebase",
                  onClick: () => act("Pull with rebase", () => api.pull(id, true), "pull"),
                },
              ]),
          },
          {
            key: "push",
            commandId: "git.push",
            label: "Push",
            icon: <IconPush />,
            badge: head?.ahead || undefined,
            onClick: () => act("Push", () => api.push(id), "push"),
            busy: workingOn.has("push"),
            onContextMenu: (e) =>
              openMenu(e, [
                {
                  label: "Push tags",
                  onClick: () => act("Push tags", () => api.push(id, false, true), "push"),
                },
                { label: "Force push, with lease…", danger: true, onClick: confirmForcePush },
              ]),
          },
          {
            key: "fetch",
            commandId: "git.fetch",
            label: "Fetch",
            icon: <IconFetch />,
            onClick: () => act("Fetch", () => api.fetch(id), "fetch"),
            busy: workingOn.has("fetch"),
            // One entry per remote, and no menu at all with none: an empty
            // menu says less than no menu.
            onContextMenu: refs.data?.remotes.length
              ? (e) =>
                  openMenu(
                    e,
                    refs.data!.remotes.map((remote) => ({
                      label: `Fetch ${remote.name}`,
                      onClick: () =>
                        act(`Fetch ${remote.name}`, () => api.fetchRemote(id, remote.name), "fetch"),
                    })),
                  )
              : undefined,
          },
        ],
        [
          {
            key: "branch",
            commandId: "git.new",
            label: "Branch",
            icon: <IconBranch />,
            onClick: () => openNewBranch(),
          },
          {
            key: "merge",
            commandId: "git.merge",
            label: "Merge",
            icon: <IconMerge />,
            onClick: openMerge,
          },
          {
            key: "stash",
            commandId: "git.stash",
            label: "Stash",
            icon: <IconStash />,
            onClick: openStash,
          },
          {
            key: "discard",
            commandId: "git.discardAll",
            label: "Discard",
            icon: <IconDiscard />,
            disabled: !head || head.unstagedCount + head.untrackedCount === 0,
            disabledReason: "Nothing to discard",
            onClick: () => confirmDiscard(discardablePaths()),
          },
        ],
        [
          {
            key: "flow",
            commandId: "git.flow",
            label: "Git Flow",
            icon: <IconFlow />,
            // A dot marks a repository already using git flow, so the button
            // says whether there is anything set up before you press it.
            badge: flow.data?.current ? 1 : undefined,
            onClick: (e) => openFlowMenu(e.clientX, e.clientY),
          },
          {
            key: "worktree",
            label: "Worktree",
            icon: <IconWorktree />,
            badge: (worktrees.data?.length ?? 0) > 1 ? worktrees.data?.length : undefined,
            commandId: "git.worktree",
            onClick: openAddWorktree,
          },
          {
            key: "submodule",
            label: "Submodule",
            icon: <IconSubmodule />,
            badge: submodules.data?.length || undefined,
            disabled: (submodules.data?.length ?? 0) === 0,
            disabledReason: "This repository has no submodules",
            onClick: openUpdateSubmodules,
          },
        ],
        [
          {
            // Beside Explorer and Terminal: all three are ways of going and
            // looking at something rather than changing it.
            key: "search",
            commandId: "view.search",
            label: "Search",
            icon: <IconSearch />,
            onClick: () => setSearchOpen(true),
          },
          {
            key: "explorer",
            commandId: "repo.explorer",
            label: "Explorer",
            icon: <IconFolder />,
            onClick: () => act("Open in Explorer", () => api.openInFileManager(id)),
          },
          {
            key: "terminal",
            commandId: "repo.terminal",
            label: "Terminal",
            icon: <IconTerminal />,
            onClick: () =>
              act("Open in terminal", () =>
                api.openInTerminal(id, settings.terminal, settings.terminalCommand),
              ),
          },
          {
            key: "editor",
            commandId: "repo.editor",
            label: "Editor",
            icon: <IconCode />,
            disabled: !editorReady,
            disabledReason: "No code editor was found. Set one in Settings.",
            onClick: () =>
              act("Open in code editor", () =>
                api.openInEditor(id, settings.editor, settings.editorCommand, settings.terminal),
              ),
          },
        ],
      ]
    : [];

  /** Everything reachable from a key or the palette.
   *
   *  A command with no handler is neither bound nor listed, so the palette
   *  shows only what can actually run right now. */
  const handlers: Record<string, (() => void) | undefined> = {
    "app.palette": () => setPaletteOpen(true),
    "app.settings": () => setSettingsOpen("general"),
    "app.keys": () => setSettingsOpen("shortcuts"),
    "app.refresh": () => void refreshAll(),
    "app.quit": () => void quit(),
    "app.activityLog": () => setLogOpen((v) => !v),
    "app.theme": cycleTheme,

    "view.search": id ? () => setSearchOpen(true) : undefined,

    // Focuses the filter belonging to whatever is in front. It was in the
    // catalog with no handler at all, so `/` and Ctrl+F were listed in
    // Settings and did nothing.
    "view.filter": () => {
      const wanted = searchOpen
        ? "search"
        : showLibrary
          ? "library"
          : isSidebarPanel(focusedPanel)
            ? "sidebar"
            : "files";

      const box =
        document.querySelector<HTMLInputElement>(`[data-filter="${wanted}"]`) ??
        document.querySelector<HTMLInputElement>('[data-filter="sidebar"]');

      box?.focus();
      box?.select();
    },

    "repo.open": () => void openRepo(),
    "repo.create": createRepo,
    "repo.clone": cloneRepo,
    "repo.library": openLibraryTab,
    "repo.rename": activeRepo ? () => editRepo(activeRepo.root) : undefined,
    // The tab in front, not the repository in front: the repository list is
    // a tab too, and it was the one case this could not close.
    "repo.close": activeId ? () => void closeRepo(activeId) : undefined,
    "repo.explorer": id ? () => act("Open in Explorer", () => api.openInFileManager(id)) : undefined,
    "repo.terminal": id
      ? () => act("Open in terminal", () => api.openInTerminal(id, settings.terminal, settings.terminalCommand))
      : undefined,
    "repo.editor":
      id && editorReady
        ? () =>
            act("Open in code editor", () =>
              api.openInEditor(id, settings.editor, settings.editorCommand, settings.terminal),
            )
        : undefined,

    // A tab shortcut only exists while that tab does, so the palette never
    // lists a repository you do not have open.
    "tab.next": tabs.length > 1 ? () => cycleTab(1) : undefined,
    "tab.previous": tabs.length > 1 ? () => cycleTab(-1) : undefined,
    "tab.last": tabs.length > 1 ? () => goToTab(tabs.length - 1) : undefined,
    // Rearranging with the keyboard as well as the pointer. The browsers'
    // own shortcut for it, so it is already in some fingers.
    "tab.moveLeft": tabs.length > 1 ? () => moveActiveTab(-1) : undefined,
    "tab.moveRight": tabs.length > 1 ? () => moveActiveTab(1) : undefined,
    ...Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        `tab.${i + 1}`,
        tabs.length > i ? () => goToTab(i) : undefined,
      ]),
    ),
    ...Object.fromEntries(
      PANELS.map((panel) => [
        `panel.${panel}`,
        // Sidebar panels need a repository; the two main ones always exist.
        id || panel === "files" || panel === "history"
          ? () => focusPanel(panel)
          : undefined,
      ]),
    ),

    "git.fetch": id ? () => act("Fetch", () => api.fetch(id), "fetch") : undefined,
    "git.pull": id ? () => act("Pull", () => api.pull(id), "pull") : undefined,
    "git.push": id ? () => act("Push", () => api.push(id), "push") : undefined,
    "git.pullRebase": id
      ? () => act("Pull with rebase", () => api.pull(id, true), "pull")
      : undefined,
    "git.pushForce": id ? confirmForcePush : undefined,
    "git.pushTags": id ? () => act("Push tags", () => api.push(id, false, true), "push") : undefined,
    "git.checkout": id ? openCheckoutByName : undefined,
    "git.tag": id ? () => openNewTag() : undefined,
    "git.remote": id ? openNewRemote : undefined,
    "git.undo": id ? confirmUndo : undefined,
    "repo.browse":
      id && hostingFor()
        ? () => browse(hostingFor()!.web)
        : undefined,
    ...Object.fromEntries(
      settings.customCommands.map((command, index) => [
        customId(index),
        id && command.context === "global" ? () => runCustom(command, {}) : undefined,
      ]),
    ),
    "git.commit": id
      ? () => {
          setView("status");
          setTimeout(() => commitRef.current?.focus(), 0);
        }
      : undefined,
    // Reads the focused panel rather than binding the key twice: a global
    // command and a sidebar one would both claim N and both fire.
    "git.new": id
      ? () => (focusedPanel === "worktrees" ? openAddWorktree() : openNewBranch())
      : undefined,
    "git.merge": id ? openMerge : undefined,
    "git.stash": id ? openStash : undefined,
    "git.discardAll": id ? () => confirmDiscard(discardablePaths()) : undefined,
    "git.worktree": id ? openAddWorktree : undefined,
    "git.flow": id ? () => openFlowMenu(...menuAnchor()) : undefined,
  };

  // A menu counts: it owns the keyboard while it is up, or J would move the
  // list behind it instead of the menu's own cursor.
  const inputOpen =
    settingsOpen || paletteOpen || dialog !== null || menu !== null || rebase !== null;

  // A stash being read that is popped or dropped -- from its own menu, say
  // -- has nothing left to read. The view goes with it rather than showing a
  // commit the sidebar no longer lists.
  useEffect(() => {
    if (!stashShown || !refs.data) return;
    if (!refs.data.stashes.some((stash) => stash.oid === stashShown.oid)) setStashShown(null);
  }, [refs.data, stashShown]);

  /** Which section's keys are live, for the strip above the status bar. */
  const hintScope: CommandScope | null = !id
    ? null
    : menu
      ? "menu"
      : isSidebarPanel(focusedPanel)
        ? "sidebar"
        : searchOpen
          ? "search"
          : blameTarget
            ? "blame"
            : stashShown
              ? null
              : view === "status"
                ? "status"
                : "history";
  useCommands(handlers, !inputOpen);

  // Nothing here is usable until the session is known, and an empty tab strip
  // above an empty panel is not a window worth showing. Held whole, then
  // handed over in one go.
  if (!restored && !bootTimedOut) {
    return (
      <Splash
        channel={app.channel}
        version={app.version}
        status={
          restoring > 0
            ? `Reopening ${restoring} ${restoring === 1 ? "repository" : "repositories"}…`
            : "Starting…"
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col outline-none">
      <header className={TABS}>
        <RepoTabs
          repos={tabs}
          activeId={activeId}
          modHeld={modHeld}
          digitFor={tabDigit}
          commandFor={(index) =>
            index < 8
              ? `tab.${index + 1}`
              : index === tabs.length - 1
                ? "tab.last"
                : undefined
          }
          onAdd={openAddRepoMenu}
          onSelect={setActiveId}
          onClose={(repoId) => void closeRepo(repoId)}
          // Written as ids rather than positions, so an order saved with one
          // set of tabs open still means something with another.
          onReorder={reorderTabs}
          onMenu={(repoId, at) => {
            const repo = tabs.find((r) => r.id === repoId);
            if (!repo) return;

            openMenuAt(at.x, at.y, [
              {
                label: "Edit…",
                hint: shortcutLabel(keymap["repo.rename"]),
                onClick: () => editRepo(repo.root),
              },
              {
                label: "All repositories…",
                hint: shortcutLabel(keymap["repo.library"]),
                onClick: openLibraryTab,
              },
              "separator",
              {
                label: "Close",
                hint: shortcutLabel(keymap["repo.close"]),
                onClick: () => void closeRepo(repo.id),
              },
            ]);
          }}
        />

        {/* Outside the scrolling strip on purpose: with a dozen repositories
            open it would otherwise scroll off the end, and settings belong to
            the app rather than to whichever tab happens to be last. */}
        <button
          className={SETTINGS_BUTTON}
          {...tip("Settings and keyboard shortcuts", "app.settings")}
          onClick={() => setSettingsOpen("general")}
          aria-label="Settings"
        >
          <IconSettings />
        </button>
      </header>

      {/* `id === null` as well as the flag, so the branch below can rely on
          there being a repository -- with no tab selected there is nothing
          else to show anyway. */}
      {showLibrary || id === null ? (
        <RepoLibrary
          repos={library.repos}
          openPaths={tabs.map((repo) => repo.root)}
          keyboardActive={!inputOpen}
          onOpen={(path) => void openFromLibrary(path)}
          lastSession={lastSession}
          onReopen={() => {
            // Clearing first: the offer is answered, whether or not every path
            // still resolves, and leaving it up would invite a second press.
            const paths = lastSession;
            setLastSession([]);
            void (async () => {
              for (const path of paths) await openFromLibrary(path);
            })();
          }}
          onEdit={editRepo}
          onRemove={confirmForgetRepo}
          onAdd={() => void openRepo()}
          onCreate={createRepo}
          onClone={cloneRepo}
        />
      ) : (
        <>
          <Toolbar groups={actions} />

          <UpdateBanner
            stage={updater.stage}
            onInstall={() => void updater.install()}
            onRestart={() => void updater.restart()}
            onDismiss={updater.dismiss}
          />

          <div
            className="grid min-h-0 flex-1"
            style={{
              gridTemplateColumns: `${sidebarWidth}px 4px minmax(0, 1fr)${logOpen ? " 380px" : ""}`,
            }}
          >
            <Sidebar
              focusedPanel={focusedPanel}
              keyboardActive={!inputOpen}
              onFocusPanel={focusPanel}
              refs={refs.data}
              status={status.data}
              worktrees={worktrees.data}
              submodules={submodules.data}
              reflog={reflogQuery.data}
              view={view}
              onCheckout={(name) => act(`Check out ${name}`, () => api.checkout(id, name))}
              // Only while history is showing: a click on a branch is not a
              // request to leave the file list.
              onReveal={(oid) => {
                if (view === "history") setHistoryFocus(oid);
              }}
              onPublish={publishBranch}
              onNewRemote={openNewRemote}
              onNewTag={() => openNewTag()}
              onShowStash={(stash) => {
                setBlameTarget(null);
                setSearchOpen(false);
                setStashShown(stash);
              }}
              onStash={(selector, action) =>
                act(
                  action === "drop" ? `Drop ${selector}` : `${action} ${selector}`,
                  () =>
                    action === "drop"
                      ? api.stashDrop(id, selector)
                      : api.stashApply(id, selector, action === "pop"),
                )
              }
              // Worktrees and submodules are separate repositories, so opening
              // one is the same operation as opening any other repo: a new tab.
              onOpenPath={(path) => void addRepo(absolute(path, activeRepo?.root))}
              onNewBranch={openNewBranch}
              onAddWorktree={openAddWorktree}
              onPruneWorktrees={() => act("Prune worktrees", () => api.pruneWorktrees(id))}
              onRemoveWorktree={confirmRemoveWorktree}
              onUpdateSubmodule={(path) =>
                act(`Update ${path}`, () => api.updateSubmodules(id, path, true))
              }
              onUpdateAllSubmodules={openUpdateSubmodules}
              onMenu={onSidebarMenu}
              onCursor={setSidebarCursor}
              onDelete={onSidebarDelete}
              onEdit={onSidebarEdit}
              onFetchRemote={(name) =>
                act(`Fetch ${name}`, () => api.fetchRemote(id, name), "fetch")
              }
            />

            <Splitter
              axis="x"
              value={sidebarWidth}
              onChange={setSidebarWidth}
              min={180}
              max={480}
            />

            <main className="flex min-w-0 min-h-0 flex-1 flex-col bg-surface">
              {head && (
                <OperationBanner
                  state={head.state}
                  conflictedCount={head.conflictedCount}
                  busy={busy}
                  onAbort={() => act("Abort operation", () => api.abortOperation(id))}
                  onContinue={() => act("Continue operation", () => api.continueOperation(id))}
                  onSkip={() => act("Skip commit", () => api.skipOperation(id))}
                  detail={
                    head.state === "bisecting" && bisect.data?.remaining != null
                      ? `${bisect.data.remaining} left to test, about ${bisect.data.steps ?? "?"} more ${bisect.data.steps === 1 ? "step" : "steps"}. HEAD is on the one to test now: mark it with B in the history.`
                      : undefined
                  }
                />
              )}

              {searchOpen ? (
                <SearchView
                  repoId={id}
                  keyboardActive={!isSidebarPanel(focusedPanel) && !inputOpen}
                  onClose={() => setSearchOpen(false)}
                  onCommit={(oid) => {
                    // History is where a commit is read, so going to one means
                    // going there rather than describing it in the results.
                    setSearchOpen(false);
                    setView("history");
                    setHistoryFocus(oid);
                  }}
                  onFile={(path) => {
                    setSearchOpen(false);
                    setBlameTarget({ path, rev: null });
                  }}
                />
              ) : stashShown ? (
                <StashView
                  repoId={id}
                  stash={stashShown}
                  onClose={() => setStashShown(null)}
                  onFileMenu={onCommitFileMenu}
                />
              ) : blameTarget ? (
                <BlameView
                  repoId={id}
                  target={blameTarget}
                  keyboardActive={!isSidebarPanel(focusedPanel) && !inputOpen}
                  onClose={() => setBlameTarget(null)}
                />
              ) : view === "status" ? (
                <FileStatusView
                  keyboardActive={!isSidebarPanel(focusedPanel) && !inputOpen}
                  repoId={id}
                  status={status.data}
                  busy={busy}
                  commitRef={commitRef}
                  onStage={(paths) =>
                    act(stageLabel("Stage", paths), () => api.stage(id, paths))
                  }
                  onUnstage={(paths) =>
                    act(stageLabel("Unstage", paths), () => api.unstage(id, paths))
                  }
                  onDiscard={(paths) => confirmDiscard(paths)}
                  onBlame={(path) => blameFile(path)}
                  onMenu={onFileMenu}
                  onCommit={(message, amend, skipHooks) =>
                    perform(amend ? "Amend commit" : "Commit", () =>
                      api.commit(id, message, amend, skipHooks),
                    )
                  }
                  onResolve={(path, side) =>
                    act(
                      `Take ${side === "ours" ? "this branch" : "the other side"} for ${path}`,
                      () => api.resolveWithSide(id, path, side),
                    )
                  }
                  onMarkResolved={(path) =>
                    act(`Mark ${path} resolved`, () => api.markResolved(id, path))
                  }
                  onEdit={openFileInEditor}
                  onMergeTool={(path) =>
                    act(`Merge tool for ${path}`, () => api.mergetool(id, path))
                  }
                  onHunk={({ path, hunk, lines, action }) =>
                    act(hunkLabel(action, lines), () =>
                      api.applyHunk(id, {
                        path,
                        hunkIndex: hunk,
                        lines,
                        mode: action,
                        contextLines: settings.diffContextLines,
                        ignoreWhitespace: settings.ignoreWhitespace,
                      }),
                    )
                  }
                />
              ) : (
                <HistoryView
                  repoId={id}
                  headOid={head?.headOid ?? null}
                  focusOid={historyFocus}
                  onFocused={() => setHistoryFocus(null)}
                  keyboardActive={!isSidebarPanel(focusedPanel) && !inputOpen}
                  onCommitMenu={openCommitMenu}
                  onFileMenu={onCommitFileMenu}
                  bisect={bisect.data}
                  onBisectMenu={openBisectMenu}
                />
              )}
            </main>

            {logOpen && (
              <ActivityLog
                entries={activity.entries}
                git={gitLog}
                onClear={activity.clear}
                onClose={() => setLogOpen(false)}
              />
            )}
          </div>
        </>
      )}

      {/* The keys for whatever is active, pinned: a strip inside a pane
          scrolls off with a long list and hides when the pane is not the one
          holding the keyboard, which is exactly when you want to know what
          the other one answers to. */}
      <KeyHints scope={showLibrary ? "library" : hintScope} />

      <footer className={STATUSBAR}>
        {head && (
          <>
            {/* The current branch doubles as a quick switcher, which is the
                place people look for one. */}
            <button
              className={BRANCH}
              {...tip("Switch branch")}
              onClick={(e) =>
                openMenu(
                  e,
                  (refs.data?.branches ?? []).map((branch) => ({
                    label: branch.isHead ? `${branch.name} (current)` : branch.name,
                    disabled: branch.isHead,
                    onClick: () =>
                      act(`Check out ${branch.name}`, () => api.checkout(id!, branch.name)),
                  })),
                )
              }
            >
              {head.head ?? "detached HEAD"}
            </button>

            {head.upstream && (
              <span>
                &uarr;{head.ahead} &darr;{head.behind} {head.upstream}
              </span>
            )}
            <span>
              {head.stagedCount} staged &middot; {head.unstagedCount} changed &middot;{" "}
              {head.untrackedCount} untracked
              {head.conflictedCount > 0 && ` · ${head.conflictedCount} conflicted`}
            </span>
          </>
        )}

        {busy && (
          <span className={ACTIVITY}>
            <span className="spinner" />
            {activity.running[0].label}
            {cloning && <span className="ml-3 font-mono text-micro text-text-faint">{cloning}</span>}
            {activity.running.length > 1 && ` +${activity.running.length - 1}`}
          </span>
        )}

        {/* What git is running right now. The line above says what was asked
            for; this says what is actually executing, which is the thing worth
            seeing when something takes longer than it should. */}
        {gitLog.running.length > 0 && (
          <span
            className={RUNNING}
            {...tipFor(
              gitLog.running.length === 1
                ? "1 git command running"
                : `${gitLog.running.length} git commands running`,
              undefined,
              gitLog.running.map(gitCommandLine).join("\n"),
            )}
          >
            <span className="spinner" />
            {gitCommandLine(gitLog.running[gitLog.running.length - 1]!)}
          </span>
        )}

        {app.channel && (
          <span
            className={`channel channel-${app.channel}`}
            {...tip(`${app.version} — ${channelCaution(app.channel)}`)}
          >
            {channelLabel(app.channel)}
          </span>
        )}

        <span className="ml-auto" />

        {head && (
          <span
            className="font-mono text-micro text-text-faint"
            {...tip("Time the last git status call took")}
          >
            status {head.durationMs}ms
          </span>
        )}

        <button
          className={STATUS_BUTTON}
          {...tip("Show every git operation and its output", "app.activityLog")}
          onClick={() => setLogOpen((v) => !v)}
        >
          Activity
          {activity.errorCount > 0 && (
            <span className={ERROR_COUNT}>{activity.errorCount}</span>
          )}
        </button>

        <button
          className={STATUS_BUTTON}
          {...tip("Switch between system, light and dark", "app.theme")}
          onClick={cycleTheme}
        >
          Theme: {settings.theme}
          {settings.theme === "system" && ` (${themeResolved})`}
        </button>

      </footer>

      <Toaster
        toasts={activity.toasts}
        onDismiss={activity.dismiss}
        onAction={runHintAction}
      />

      {dialog && <Dialog spec={dialog} onClose={() => setDialog(null)} />}
      {rebase && (
        <RebaseEditor
          plan={rebase.plan}
          preset={rebase.preset}
          onClose={() => setRebase(null)}
          onRun={(base, steps) => {
            setRebase(null);
            act("Rebase", () => api.rebaseRun(id!, base, steps));
          }}
        />
      )}
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
      {settingsOpen && (
        <SettingsDialog
          initialSection={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          handlers={handlers}
          custom={customGlobals}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

function hunkLabel(action: "stage" | "unstage" | "discard", lines?: number[]) {
  const verb = action === "stage" ? "Stage" : action === "unstage" ? "Unstage" : "Discard";
  if (!lines) return `${verb} hunk`;

  return `${verb} ${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
}

function stageLabel(verb: string, paths: string[]) {
  return paths.length === 1 ? `${verb} ${paths[0]}` : `${verb} ${paths.length} files`;
}

/** Submodule paths are relative to the superproject; worktree paths are not. */
function absolute(path: string, root: string | undefined) {
  const isAbsolute = /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(path);
  return isAbsolute || !root ? path : `${root}/${path}`;
}
