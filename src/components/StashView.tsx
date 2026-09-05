import type { StashEntry } from "../lib/api";
import { CommitDetail } from "./CommitDetail";

interface Props {
  repoId: string;
  stash: StashEntry;
  onClose: () => void;
  onFileMenu: (path: string, at: { x: number; y: number }) => void;
}

const BAR =
  "flex items-center gap-4 border-b border-b-border-soft bg-surface-alt px-6 py-3 text-body";

/** A stash, read as the commit it is.
 *
 *  Git stores a stash as a commit whose first parent is where you were, so
 *  the commit detail already knows how to show what it holds. This only adds
 *  the header saying which stash it is and a way back. */
export function StashView({ repoId, stash, onClose, onFileMenu }: Props) {
  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
      <div className={BAR}>
        <span className="font-mono text-small text-text-dim">{stash.selector}</span>
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {stash.message}
        </span>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>

      <CommitDetail repoId={repoId} oid={stash.oid} onFileMenu={onFileMenu} />
    </div>
  );
}
