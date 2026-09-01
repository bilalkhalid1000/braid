import { summarise } from "../lib/releaseNotes";
import type { UpdateStage } from "../lib/useUpdater";

interface Props {
  stage: UpdateStage;
  onInstall: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}

/** A new version, offered rather than imposed.
 *
 *  Sits under the toolbar instead of appearing as a modal: an update is never
 *  urgent enough to take the window away from someone mid-commit. */
export function UpdateBanner({ stage, onInstall, onRestart, onDismiss }: Props) {
  // The states worth a banner are the ones with something to decide or to wait
  // for. "Checking" and "up to date" belong in Settings, where they were asked
  // for.
  if (
    stage.state === "idle" ||
    stage.state === "checking" ||
    stage.state === "upToDate" ||
    stage.state === "failed"
  ) {
    return null;
  }

  return (
    <div className="update-banner" role="status">
      {stage.state === "available" && (
        <>
          <span className="update-text">
            <span className="update-title">Version {stage.version} is available</span>
            {stage.notes && <span className="update-notes">{summarise(stage.notes)}</span>}
          </span>

          <div className="update-actions">
            <button className="btn" onClick={onDismiss}>
              Not now
            </button>
            <button className="btn-primary" onClick={onInstall}>
              Download and install
            </button>
          </div>
        </>
      )}

      {stage.state === "downloading" && (
        <>
          <span className="update-text">
            <span className="update-title">Downloading {stage.version}</span>
            <span className="update-notes">
              {stage.percent === null
                ? "The server did not report a size, so there is no progress to show."
                : `${stage.percent}%`}
            </span>
          </span>

          {stage.percent !== null && (
            <span className="update-meter" aria-hidden="true">
              <span className="update-meter-fill" style={{ width: `${stage.percent}%` }} />
            </span>
          )}
        </>
      )}

      {stage.state === "ready" && (
        <>
          <span className="update-text">
            <span className="update-title">Version {stage.version} is ready</span>
            <span className="update-notes">
              It takes effect when the app restarts. Commit anything in progress first.
            </span>
          </span>

          <div className="update-actions">
            <button className="btn" onClick={onDismiss}>
              Later
            </button>
            <button className="btn-primary" onClick={onRestart}>
              Restart now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
