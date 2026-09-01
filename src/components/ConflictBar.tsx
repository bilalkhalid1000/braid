import type { RepoState } from "../lib/api";

interface Props {
  path: string;
  state: RepoState;
  busy: boolean;
  onTake: (side: "ours" | "theirs") => void;
  onMarkResolved: () => void;
}

/** What "ours" and "theirs" mean, in words, for the operation actually running.
 *
 *  Git's own labels invert during a rebase: your commits are replayed *onto*
 *  the other branch, so `--ours` is the branch you are rebasing onto and
 *  `--theirs` is your own work. That trips up people who have used git for
 *  years, so the buttons never say "ours" — they name the branch's role. */
function sideLabels(state: RepoState): { ours: string; theirs: string; note: string } {
  if (state === "rebasing") {
    return {
      ours: "the branch you are rebasing onto",
      theirs: "the commit being replayed",
      note: "During a rebase your own commit is the incoming side, which is the reverse of a merge.",
    };
  }

  if (state === "cherryPicking") {
    return {
      ours: "this branch",
      theirs: "the commit being picked",
      note: "",
    };
  }

  return {
    ours: "this branch",
    theirs: "the branch being merged in",
    note: "",
  };
}

const BAR = "flex items-center gap-6 border-b border-b-border bg-removed-bg px-6 py-3";
const ACTION = "px-4 py-[3px] text-small whitespace-nowrap";

/** Resolving one conflicted file.
 *
 *  Sits above the diff so the choice is next to the thing being decided. Taking
 *  a side writes it into the working copy and stages it; editing by hand and
 *  pressing "Mark resolved" does the same with whatever you wrote. */
export function ConflictBar({ path, state, busy, onTake, onMarkResolved }: Props) {
  const labels = sideLabels(state);

  return (
    <div className={BAR}>
      <div className="grid min-w-0 gap-1">
        <span className="font-semibold text-conflict">This file has conflicts</span>
        <span className="text-small leading-[1.45] text-text-dim">
          Take one side whole, or edit {shortPath(path)} and mark it resolved.
          {labels.note && ` ${labels.note}`}
        </span>
      </div>

      <div className="ml-auto flex flex-none gap-3">
        <button className={`btn ${ACTION}`} disabled={busy} onClick={() => onTake("ours")}>
          Take {labels.ours}
        </button>
        <button className={`btn ${ACTION}`} disabled={busy} onClick={() => onTake("theirs")}>
          Take {labels.theirs}
        </button>
        <button className={`btn-primary ${ACTION}`} disabled={busy} onClick={onMarkResolved}>
          Mark resolved
        </button>
      </div>
    </div>
  );
}

function shortPath(path: string) {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}
