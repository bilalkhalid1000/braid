import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  api,
  diffTargetFor,
  isStaged,
  isUnstaged,
  type RepoStatus,
  type StatusEntry,
} from "../lib/api";
import { FileList } from "./FileList";
import { DiffView, type HunkRequest } from "./DiffView";
import { ConflictBar } from "./ConflictBar";
import { CommitBox, type CommitBoxHandle } from "./CommitBox";
import { nextConflict } from "../lib/conflicts";
import { useCommands } from "../lib/useCommands";
import { useSettings } from "../lib/settings";
import { FilterInput, matchesFilter } from "./FilterInput";
import { Splitter, usePaneSize } from "./Splitter";

interface Selection {
  path: string;
  staged: boolean;
}

interface Props {
  repoId: string;
  /** False while a sidebar panel holds the keyboard. */
  keyboardActive: boolean;
  status: RepoStatus | undefined;
  busy: boolean;
  commitRef: React.RefObject<CommitBoxHandle | null>;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onBlame: (path: string) => void;
  onMenu: (
    entry: StatusEntry,
    staged: boolean,
    point: { x: number; y: number },
  ) => void;
  onCommit: (message: string, amend: boolean, skipHooks: boolean) => Promise<boolean>;
  onHunk: (request: HunkRequest & { path: string }) => void;
  onResolve: (path: string, side: "ours" | "theirs") => void;
  onMarkResolved: (path: string) => void;
  onEdit: (path: string) => void;
  onMergeTool: (path: string) => void;
}

export function FileStatusView({
  repoId,
  keyboardActive,
  status,
  busy,
  commitRef,
  onStage,
  onUnstage,
  onDiscard,
  onBlame,
  onMenu,
  onCommit,
  onHunk,
  onResolve,
  onMarkResolved,
  onEdit,
  onMergeTool,
}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [filter, setFilter] = useState("");
  const [columnWidth, setColumnWidth] = usePaneSize("status-column", 380);
  const { settings } = useSettings();

  const staged = useMemo(
    () => (status?.entries ?? []).filter(isStaged).filter((e) => matchesFilter(e.path, filter)),
    [status, filter],
  );

  const unstaged = useMemo(
    () =>
      (status?.entries ?? [])
        .filter((e) => isUnstaged(e) && e.kind !== "ignored")
        .filter((e) => matchesFilter(e.path, filter)),
    [status, filter],
  );

  // Arrow keys walk both lists as one sequence, which is how they read.
  const ordered = useMemo(
    () => [
      ...staged.map((entry) => ({ entry, staged: true })),
      ...unstaged.map((entry) => ({ entry, staged: false })),
    ],
    [staged, unstaged],
  );

  const index = ordered.findIndex(
    (row) => row.entry.path === selection?.path && row.staged === selection.staged,
  );

  // A file that was staged, committed or discarded is no longer selectable.
  // Move to whatever took its place rather than leaving a stale diff on screen.
  useEffect(() => {
    if (selection && index === -1) {
      setSelection(null);
    }
  }, [selection, index]);

  const selected = index >= 0 ? ordered[index] : undefined;

  const diff = useQuery({
    queryKey: [
      "diff",
      repoId,
      selected?.entry.path,
      selected?.staged,
      settings.diffContextLines,
      settings.ignoreWhitespace,
    ],
    queryFn: () =>
      api.fileDiff(
        repoId,
        selected!.entry.path,
        diffTargetFor(selected!.entry, selected!.staged),
        settings.diffContextLines,
        settings.ignoreWhitespace,
      ),
    enabled: Boolean(selected),
    staleTime: Infinity,
  });

  const select = (entry: StatusEntry, isStagedSide: boolean) =>
    setSelection({ path: entry.path, staged: isStagedSide });

  const move = (delta: number) => {
    if (ordered.length === 0) return;
    const next = ordered[Math.min(Math.max(index + delta, 0), ordered.length - 1)];
    if (next) select(next.entry, next.staged);
  };

  const jumpConflict = (delta: 1 | -1) => {
    const at = nextConflict(
      ordered.map((row) => row.entry.kind),
      index,
      delta,
    );
    const row = ordered[at];
    if (row) select(row.entry, row.staged);
  };

  const toggle = (entry: StatusEntry, isStagedSide: boolean) =>
    isStagedSide ? onUnstage([entry.path]) : onStage([entry.path]);

  // Registered while this view is mounted, which is what lets History reuse the
  // same J and K without a conflict.
  useCommands({
    "status.next": () => move(1),
    "status.previous": () => move(-1),
    "status.toggle": () => selected && toggle(selected.entry, selected.staged),
    "status.stageAll": () => onStage(unstaged.map((e) => e.path)),
    "status.unstageAll": () => onUnstage(staged.map((e) => e.path)),
    "status.discard": () =>
      selected && !selected.staged && onDiscard([selected.entry.path]),
    "status.commit": () => commitRef.current?.submit(),
    "status.blame": () => selected && onBlame(selected.entry.path),
    "status.edit": () => selected && onEdit(selected.entry.path),
    "status.mergetool": () =>
      selected?.entry.kind === "unmerged" && onMergeTool(selected.entry.path),
    "status.nextConflict": () => jumpConflict(1),
    "status.previousConflict": () => jumpConflict(-1),
    // The row's menu, opened under the row so it reads as belonging to it.
    "status.menu": () => {
      if (!selected) return;
      const key = `${selected.staged ? "staged" : "unstaged"}:${selected.entry.path}`;
      const box = document
        .querySelector(`[data-entry="${CSS.escape(key)}"]`)
        ?.getBoundingClientRect();
      onMenu(selected.entry, selected.staged, box ? { x: box.left + 48, y: box.bottom } : { x: 240, y: 200 });
    },
  }, keyboardActive);

  const total = (status?.entries ?? []).filter((e) => e.kind !== "ignored").length;

  return (
    <div
      className="grid min-h-0 flex-1 basis-auto outline-none"
      style={{ gridTemplateColumns: `${columnWidth}px 4px minmax(0, 1fr)` }}
    >
      <div className="flex min-h-0 flex-col [&>*:first-child]:flex-none">
        <div className="sticky top-0 z-[1] flex-none px-4 py-3 bg-surface-alt border-b border-b-border-soft">
          <FilterInput
            value={filter}
            onChange={setFilter}
            name="files"
            placeholder="Filter files"
            matches={staged.length + unstaged.length}
          />
        </div>

        <FileList
          title="Staged"
          entries={staged}
          staged
          selectedPath={selection?.staged ? selection.path : null}
          onSelect={(e) => select(e, true)}
          onToggle={(e) => onUnstage([e.path])}
          onToggleAll={() => onUnstage(staged.map((e) => e.path))}
          onMenu={(entry, point) => onMenu(entry, true, point)}
          actionLabel="Unstage all"
          actionCommand="status.unstageAll"
          emptyMessage={filter ? "No matches" : "Nothing staged yet"}
        />

        <FileList
          title="Changes"
          entries={unstaged}
          staged={false}
          selectedPath={selection && !selection.staged ? selection.path : null}
          onSelect={(e) => select(e, false)}
          onToggle={(e) => onStage([e.path])}
          onToggleAll={() => onStage(unstaged.map((e) => e.path))}
          onMenu={(entry, point) => onMenu(entry, false, point)}
          actionLabel="Stage all"
          actionCommand="status.stageAll"
          // Discard lives only on this list. Staged work is one step from
          // safety; what is here is the work git has no record of yet.
          secondary={{
            label: "Discard all",
            command: "git.discardAll",
            onClick: () => onDiscard(unstaged.map((e) => e.path)),
          }}
          rowAction={{ label: "discard", onClick: (e) => onDiscard([e.path]) }}
          emptyMessage={
            filter ? "No matches" : total === 0 ? "Working tree clean" : "Everything is staged"
          }
        />

        <CommitBox
          ref={commitRef}
          stagedCount={status?.stagedCount ?? 0}
          busy={busy}
          onCommit={onCommit}
        />

      </div>

      <Splitter
        axis="x"
        value={columnWidth}
        onChange={setColumnWidth}
        min={260}
        max={720}
      />

      <div className="flex min-w-0 min-h-0 flex-col">
        {selected?.entry.kind === "unmerged" && status && (
          <ConflictBar
            path={selected.entry.path}
            state={status.state}
            busy={busy}
            onTake={(side) => onResolve(selected.entry.path, side)}
            onMarkResolved={() => onMarkResolved(selected.entry.path)}
            onEdit={() => onEdit(selected.entry.path)}
            onMergeTool={() => onMergeTool(selected.entry.path)}
          />
        )}

        <DiffView
          diff={diff.data}
          loading={diff.isFetching}
          staged={selected?.staged}
          // An untracked file has no diff git can apply a patch against, so it
          // is staged whole or not at all.
          onHunk={
            selected && selected.entry.kind !== "untracked"
              ? (request) => onHunk({ ...request, path: selected.entry.path })
              : undefined
          }
          emptyMessage={
            total === 0
              ? "Nothing has changed since the last commit"
              : "Select a file to see its changes"
          }
        />
      </div>
    </div>
  );
}
