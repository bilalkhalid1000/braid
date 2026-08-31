import { operationLabel, type RepoState } from "../lib/api";

interface Props {
  state: RepoState;
  conflictedCount: number;
  busy: boolean;
  onAbort: () => void;
  onContinue: () => void;
  onSkip: () => void;
}

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
    <div className="op-banner" role="status">
      <span className="op-dot" />

      <span className="op-title">{operationLabel[state]}</span>

      <span className="op-detail">
        {conflictedCount > 0
          ? `${conflictedCount} file${conflictedCount === 1 ? "" : "s"} still conflicted`
          : state === "bisecting"
            ? "Mark commits good or bad from your terminal"
            : "Conflicts resolved — ready to continue"}
      </span>

      <div className="op-actions">
        {canSkip && (
          <button className="btn" disabled={busy} onClick={onSkip}>
            Skip commit
          </button>
        )}

        {canContinue && (
          <button
            className="btn-primary"
            // Continuing with files still unmerged only produces another
            // refusal, so the button says so by being unavailable.
            disabled={busy || !resolved}
            title={resolved ? undefined : "Resolve and stage the conflicts first"}
            onClick={onContinue}
          >
            Continue
          </button>
        )}

        <button className="btn-danger" disabled={busy} onClick={onAbort}>
          Abort
        </button>
      </div>
    </div>
  );
}
