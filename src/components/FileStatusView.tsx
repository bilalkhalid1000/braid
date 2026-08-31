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
  onCommit: (message: string, amend: boolean) => Promise<boolean>;
  onHunk: (request: HunkRequest & { path: string }) => void;
  onResolve: (path: string, side: "ours" | "theirs") => void;
  onMarkResolved: (path: string) => void;
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
  onCommit,
  onHunk,
  onResolve,
  onMarkResolved,
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
  }, keyboardActive);

  const total = (status?.entries ?? []).filter((e) => e.kind !== "ignored").length;

  return (
    <div
      className="file-status"
      style={{ gridTemplateColumns: `${columnWidth}px 4px minmax(0, 1fr)` }}
    >
      <div className="fs-left">
        <div className="fs-filter">
          <FilterInput
            value={filter}
            onChange={setFilter}
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
          actionLabel="Unstage all"
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
          actionLabel="Stage all"
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

      <div className="fs-right">
        {selected?.entry.kind === "unmerged" && status && (
          <ConflictBar
            path={selected.entry.path}
            state={status.state}
            busy={busy}
            onTake={(side) => onResolve(selected.entry.path, side)}
            onMarkResolved={() => onMarkResolved(selected.entry.path)}
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
