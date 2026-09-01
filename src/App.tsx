import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useKeyHold } from "@tanstack/react-hotkeys";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  api,
  flowNoun,
  isReleaseKind,
  onCloneProgress,
  onRepoChanged,
  type CurrentFlow,
  type BlameTarget,
  type BranchRef,
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
import { Dialog, type DialogSpec } from "./components/Dialog";
import type { ComboOption } from "./components/Combo";
import { cloneDestination, repoNameFromUrl } from "./lib/cloneTarget";
import { splitUpstream } from "./lib/upstream";
import { FlowPlan, type FlowPlanTarget } from "./components/FlowPlan";
import { BlameView } from "./components/BlameView";
import { Splash } from "./components/Splash";
import { IconSettings } from "./components/icons";
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
import { useCommands } from "./lib/useCommands";
import { shortcutLabel } from "./lib/shortcutLabel";
import { useActivity } from "./lib/useActivity";
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
];

export default function App() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("status");
  // Which region the keyboard is driving. Files and History are the main
  // panel; the rest are sidebar lists.
  const [focusedPanel, setFocusedPanel] = useState<PanelId>("files");
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  // The file being blamed, if any. Blame takes over the main panel
  // rather than becoming a third workspace view, so the number keys and
  // the sidebar keep meaning exactly what they meant before.
  const [blameTarget, setBlameTarget] = useState<BlameTarget | null>(null);
  /** What the sidebar's keyboard cursor is on, so Merge can act on it. */
  const [sidebarCursor, setSidebarCursor] = useState<MenuTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<false | "general" | "shortcuts">(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Nothing may be written back until the restore has finished, or the first
  // save would overwrite the stored session with an empty list.
  const [restored, setRestored] = useState(false);
  /** How many tabs the restore is reopening, so the wait can say so. */
  const [restoring, setRestoring] = useState(0);
  /** Reveal the app even if the restore never finishes.
   *
   *  Deliberately a separate flag from `restored`, which also gates writing the
   *  session back: forcing that one would let an empty repo list overwrite what
   *  is stored. This only decides whether the splash is still up. */
  const [bootTimedOut, setBootTimedOut] = useState(false);
  /** What a running clone is doing, or null when none is. */
  const [cloning, setCloning] = useState<string | null>(null);
  const { settings, keymap, update: updateSettings, loaded: settingsLoaded } = useSettings();

  /** Numbers jump to a panel. Files and History also switch the main view;
   *  the sidebar panels leave it alone so you can browse branches while still
   *  looking at history. */
  const focusPanel = (panel: PanelId) => {
    if (panel === "files") setView("status");
    if (panel === "history") setView("history");
    // A blame covers the main panel, so asking for a panel has to close it --
    // otherwise pressing 2 would look like it did nothing.
    if (panel === "files" || panel === "history") setBlameTarget(null);
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

  const worktrees = useQuery({
    queryKey: ["worktrees", activeId],
    queryFn: () => api.listWorktrees(activeId!),
    enabled: activeId !== null,
    ...eventDriven,
  });

  const submodules = useQuery({
    queryKey: ["submodules", activeId],
    queryFn: () => api.listSubmodules(activeId!),
    enabled: activeId !== null,
    ...eventDriven,
  });

  const flow = useQuery({
    queryKey: ["flow", activeId],
    queryFn: () => api.flowStatus(activeId!),
    enabled: activeId !== null,
    ...eventDriven,
  });

  // Reopen the tabs that were open last time.
  //
  // Repositories that have since been moved or deleted are skipped rather than
  // failing the whole restore, and reported once at the end instead of as one
  // error per repository.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (!settings.restoreTabs) return;

        const stored = await api.loadSession();
        if (cancelled) return;

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

  // A string rather than the array, so a refetch that returns an identical list
  // does not rewrite the file.
  const sessionKey = JSON.stringify([repos.data.map((r) => r.root), activeId]);

  useEffect(() => {
    if (!restored) return;

    void api.saveSession({
      repos: repos.data.map((r) => r.root),
      active: activeId,
    });
    // sessionKey is the value that decides whether a write is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, sessionKey]);

  const activeRepo = repos.data.find((r) => r.id === activeId);
  const head = status.data;
  const id = activeId;
  const busy = activity.running.length > 0;

  /** Run a git action with a name attached.
   *
   *  The label is what the user sees in the toast, the status bar and the
   *  activity log, so it is written as the thing they asked for rather than
   *  the command that implements it. */
  const perform = async (label: string, action: () => Promise<unknown>) => {
    const ok = await activity.run(label, action);

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

  const act = (label: string, action: () => Promise<unknown>) => {
    void perform(label, action);
  };

  const addRepo = (path: string) =>
    perform(`Open ${path}`, async () => {
      const repo = await api.openRepo(path);
      await queryClient.invalidateQueries({ queryKey: ["repos"] });
      setActiveId(repo.id);
      return `Opened ${repo.root}`;
    });

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
    ]);

  /** Tabs are listed in the order the strip shows them, so an index here is
   *  the position you can actually see. */
  const goToTab = (index: number) => {
    const repo = repos.data[index];
    if (repo) setActiveId(repo.id);
  };

  /** The digit that selects a tab, or null for one no digit reaches.
   *
   *  Past the eighth tab only the last is addressable, on 9 — so that is the
   *  only one still worth labelling. */
  const tabDigit = (index: number): number | null => {
    if (index < 8) return index + 1;
    return index === repos.data.length - 1 ? 9 : null;
  };

  /** Wraps, so Ctrl+Tab keeps cycling rather than stopping at the last one. */
  const cycleTab = (delta: number) => {
    const list = repos.data;
    if (list.length < 2) return;

    const current = list.findIndex((repo) => repo.id === activeId);
    const next = (current + delta + list.length) % list.length;
    setActiveId(list[next].id);
  };

  const closeRepo = async (repoId: string) => {
    await api.closeRepo(repoId);
    await queryClient.invalidateQueries({ queryKey: ["repos"] });
    if (activeId === repoId) {
      setActiveId(repos.data.find((r) => r.id !== repoId)?.id ?? null);
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
            note: `tag ${config?.versiontag ?? ""}${current.name}`,
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
              key: "tag",
              label: "Tag message",
              placeholder: `${config?.versiontag ?? ""}${current.name}`,
              optional: true,
            },
          ]
        : undefined,
      checkboxes: [
        { key: "delete", label: `Delete ${current.branch} afterwards`, value: true },
        { key: "push", label: "Push the result to origin" },
      ],
      confirmLabel: "Finish",
      onConfirm: (v) =>
        act(`Finish ${flowNoun[current.kind]} ${current.name}`, () =>
          api.flowFinish(id, current.kind, current.name, {
            deleteBranch: v.delete === "true",
            push: v.push === "true",
            tagMessage: v.tag ?? "",
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

  const openNewBranch = () =>
    setDialog({
      title: "New branch",
      fields: [{ key: "name", label: "Branch name", placeholder: "feature/thing" }],
      confirmLabel: "Create branch",
      onConfirm: (v) =>
        act(`Create branch ${v.name}`, () => api.createBranch(id!, v.name, true)),
    });

  /** Everything that can be merged, local first. */
  const mergeSources = (): ComboOption[] => [
    ...(refs.data?.branches ?? [])
      .filter((branch) => !branch.isHead)
      .map((branch) => ({ value: branch.name })),
    ...(refs.data?.remotes ?? []).flatMap((remote) =>
      remote.branches.map((branch) => ({
        value: `${remote.name}/${branch}`,
        note: remote.name,
      })),
    ),
    ...(refs.data?.tags ?? []).map((tag) => ({ value: tag, note: "tag" })),
  ];

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
          options: mergeSources(),
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
      checkboxes: [{ key: "untracked", label: "Include untracked files", value: true }],
      confirmLabel: "Stash",
      onConfirm: (v) =>
        act("Stash changes", () => api.stashPush(id!, v.message, v.untracked === "true")),
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
      {
        label: "Discard changes…",
        danger: true,
        disabled: staged,
        onClick: () => confirmDiscard([entry.path]),
      },
    ]);
  };

  /** Delete whatever the sidebar cursor is on.
   *
   *  Every one of these already had a menu entry; this is the same action
   *  reached by a key. All of them confirm first -- the key is one press, and
   *  none of these are things to lose by leaning on D. */
  const onSidebarDelete = (target: MenuTarget) => {
    if (!id) return;

    switch (target.kind) {
      case "branch":
        // The branch you are standing on cannot be deleted, and offering it
        // would only produce git's refusal a dialog later.
        if (!target.branch.isHead) confirmDeleteBranch(target.branch);
        break;

      case "stash":
        confirmDropStash(target.stash.selector, target.stash.message);
        break;

      case "worktree":
        if (!target.worktree.isMain) confirmRemoveWorktree(target.worktree.path);
        break;

      // A remote branch, a tag and a submodule each need their own operation,
      // and none of them exist yet. Doing nothing beats guessing.
      default:
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
          "separator",
          {
            label: "Delete branch…",
            danger: true,
            disabled: branch.isHead,
            onClick: () => confirmDeleteBranch(branch),
          },
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
            onClick: () => act("Pull", () => api.pull(id)),
          },
          {
            key: "push",
            commandId: "git.push",
            label: "Push",
            icon: <IconPush />,
            badge: head?.ahead || undefined,
            onClick: () => act("Push", () => api.push(id)),
          },
          {
            key: "fetch",
            commandId: "git.fetch",
            label: "Fetch",
            icon: <IconFetch />,
            onClick: () => act("Fetch", () => api.fetch(id)),
          },
        ],
        [
          {
            key: "branch",
            commandId: "git.new",
            label: "Branch",
            icon: <IconBranch />,
            onClick: openNewBranch,
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
            onClick: () => act("Open in terminal", () => api.openInTerminal(id)),
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

    "repo.open": () => void openRepo(),
    "repo.create": createRepo,
    "repo.clone": cloneRepo,
    "repo.close": id ? () => void closeRepo(id) : undefined,
    "repo.explorer": id ? () => act("Open in Explorer", () => api.openInFileManager(id)) : undefined,
    "repo.terminal": id ? () => act("Open in terminal", () => api.openInTerminal(id)) : undefined,

    // A tab shortcut only exists while that tab does, so the palette never
    // lists a repository you do not have open.
    "tab.next": repos.data.length > 1 ? () => cycleTab(1) : undefined,
    "tab.previous": repos.data.length > 1 ? () => cycleTab(-1) : undefined,
    "tab.last": repos.data.length > 1 ? () => goToTab(repos.data.length - 1) : undefined,
    ...Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        `tab.${i + 1}`,
        repos.data.length > i ? () => goToTab(i) : undefined,
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

    "git.fetch": id ? () => act("Fetch", () => api.fetch(id)) : undefined,
    "git.pull": id ? () => act("Pull", () => api.pull(id)) : undefined,
    "git.push": id ? () => act("Push", () => api.push(id)) : undefined,
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
  const inputOpen = settingsOpen || paletteOpen || dialog !== null || menu !== null;
  useCommands(handlers, !inputOpen);

  // Nothing here is usable until the session is known, and an empty tab strip
  // above an empty panel is not a window worth showing. Held whole, then
  // handed over in one go.
  if (!restored && !bootTimedOut) {
    return (
      <Splash
        channel={app.channel}
        status={
          restoring > 0
            ? `Reopening ${restoring} ${restoring === 1 ? "repository" : "repositories"}…`
            : "Starting…"
        }
      />
    );
  }

  return (
    <div className="app">
      <header className="tabs">
        <div className="tab-strip">
          {repos.data.map((repo, index) => (
            <div
              key={repo.id}
              className={`tab ${repo.id === activeId ? "tab-active" : ""}`}
              onClick={() => setActiveId(repo.id)}
              {...tip(
                repo.root,
                index < 8
                  ? `tab.${index + 1}`
                  : index === repos.data.length - 1
                    ? "tab.last"
                    : undefined,
              )}
            >
              {modHeld && tabDigit(index) !== null && (
                <kbd className="tab-key">{tabDigit(index)}</kbd>
              )}
              <span className="tab-name">{repo.name}</span>
              <span
                className="tab-close"
                {...tip("Close repository", "repo.close")}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeRepo(repo.id);
                }}
              >
                &times;
              </span>
          </div>
        ))}

          <button
            className="tab tab-add"
            {...tip("Open or create a repository", "repo.open")}
            onClick={openAddRepoMenu}
          >
            +
          </button>
        </div>

        {/* Outside the scrolling strip on purpose: with a dozen repositories
            open it would otherwise scroll off the end, and settings belong to
            the app rather than to whichever tab happens to be last. */}
        <button
          className="tab-settings"
          {...tip("Settings and keyboard shortcuts", "app.settings")}
          onClick={() => setSettingsOpen("general")}
          aria-label="Settings"
        >
          <IconSettings />
        </button>
      </header>

      {id === null ? (
        <div className="welcome">
          <h1>
            Braid
            {app.channel && (
              <span className={`channel channel-${app.channel}`}>
                {channelLabel(app.channel)}
              </span>
            )}
          </h1>
          <p>
            Open a repository to see its working copy and history. Open as many as you
            like — each one gets a tab, and idle tabs cost nothing.
          </p>
          <p className="welcome-caution">
            {channelCaution(app.channel)}
          </p>
          <div className="welcome-actions">
            <button className="btn-primary" onClick={() => void openRepo()}>
              Open repository
            </button>
            <button className="btn" onClick={createRepo}>
              Create repository
            </button>
          </div>
          <p className="welcome-hint">Ctrl+O to open · Ctrl+N to create</p>
        </div>
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
            className={`body ${logOpen ? "body-with-log" : ""}`}
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
              view={view}
              onCheckout={(name) => act(`Check out ${name}`, () => api.checkout(id, name))}
              onPublish={publishBranch}
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
            />

            <Splitter
              axis="x"
              value={sidebarWidth}
              onChange={setSidebarWidth}
              min={180}
              max={480}
            />

            <main className="content">
              {head && (
                <OperationBanner
                  state={head.state}
                  conflictedCount={head.conflictedCount}
                  busy={busy}
                  onAbort={() => act("Abort operation", () => api.abortOperation(id))}
                  onContinue={() => act("Continue operation", () => api.continueOperation(id))}
                  onSkip={() => act("Skip commit", () => api.skipOperation(id))}
                />
              )}

              {blameTarget ? (
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
                  onCommit={(message, amend) =>
                    perform(amend ? "Amend commit" : "Commit", () =>
                      api.commit(id, message, amend),
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
                  keyboardActive={!isSidebarPanel(focusedPanel) && !inputOpen}
                />
              )}
            </main>

            {logOpen && (
              <ActivityLog
                entries={activity.entries}
                onClear={activity.clear}
                onClose={() => setLogOpen(false)}
              />
            )}
          </div>
        </>
      )}

      <footer className="statusbar">
        {head && (
          <>
            {/* The current branch doubles as a quick switcher, which is the
                place people look for one. */}
            <button
              className="branch"
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
          <span className="activity">
            <span className="spinner" />
            {activity.running[0].label}
            {cloning && <span className="activity-detail">{cloning}</span>}
            {activity.running.length > 1 && ` +${activity.running.length - 1}`}
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

        <span className="statusbar-spacer" />

        {head && (
          <span
            className="timing"
            {...tip("Time the last git status call took")}
          >
            status {head.durationMs}ms
          </span>
        )}

        <button
          className="statusbar-button"
          {...tip("Show every git operation and its output", "app.activityLog")}
          onClick={() => setLogOpen((v) => !v)}
        >
          Activity
          {activity.errorCount > 0 && (
            <span className="statusbar-error-count">{activity.errorCount}</span>
          )}
        </button>

        <button
          className="statusbar-button"
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
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
      {settingsOpen && (
        <SettingsDialog
          initialSection={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {paletteOpen && (
        <CommandPalette handlers={handlers} onClose={() => setPaletteOpen(false)} />
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
