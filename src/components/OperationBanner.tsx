import { operationLabel, type RepoState } from "../lib/api";

interface Props {
  state: RepoState;
  conflictedCount: number;
  busy: boolean;
  onAbort: () => void;
  onContinue: () => void;
  onSkip: () => void;
}

const BANNER =
  "flex flex-none items-center gap-4 border-b border-b-border bg-modified-bg px-6 py-3";

/* The detail is what gets cut when the window is narrow; the operation's name
   is the part nothing else on screen says. */
const DETAIL = "overflow-hidden text-ellipsis whitespace-nowrap text-small text-text-dim";

const ACTION = "px-6 py-[3px] text-small";

/** What the repository is in the middle of, and the way out.
 *
 *  A pull that hits a conflict leaves a half-finished merge behind, and until
 *  it is resolved most other git commands refuse to run. Without this the user
 *  sees an error, then a series of unrelated-looking refusals, with nothing
 *  saying the repository is still mid-operation. */
export function OperationBanner({
  state,
  conflictedCount,
  busy,
  onAbort,
  onContinue,
  onSkip,
}: Props) {
  if (state === "clean") return null;

  const canSkip = state === "rebasing" || state === "cherryPicking";
  const canContinue = state !== "bisecting";
  const resolved = conflictedCount === 0;

  return (
    <div className={BANNER} role="status">
      <span className="size-4 flex-none rounded-full bg-modified" />

      <span className="font-semibold">{operationLabel[state]}</span>

      <span className={DETAIL}>
        {conflictedCount > 0
          ? `${conflictedCount} file${conflictedCount === 1 ? "" : "s"} still conflicted`
          : state === "bisecting"
            ? "Mark commits good or bad from your terminal"
            : "Conflicts resolved — ready to continue"}
      </span>

      <div className="ml-auto flex gap-3">
        {canSkip && (
          <button className={`btn ${ACTION}`} disabled={busy} onClick={onSkip}>
            Skip commit
          </button>
        )}

        {canContinue && (
          <button
            className={`btn-primary ${ACTION}`}
            // Continuing with files still unmerged only produces another
            // refusal, so the button says so by being unavailable.
            disabled={busy || !resolved}
            title={resolved ? undefined : "Resolve and stage the conflicts first"}
            onClick={onContinue}
          >
            Continue
          </button>
        )}

        <button className={`btn-danger ${ACTION}`} disabled={busy} onClick={onAbort}>
          Abort
        </button>
      </div>
    </div>
  );
}
