import { summarise } from "../lib/releaseNotes";
import type { UpdateStage } from "../lib/useUpdater";

interface Props {
  stage: UpdateStage;
  onInstall: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}

/* One line, not two. Stacked, the note under the title made this as tall as the
   toolbar above it -- more of the window than something being offered should
   take, and across a wide monitor it read as a band of colour with a sentence
   lost in it. The lane down the left edge replaced a loose dot: same signal,
   attached to the bar rather than floating beside it, and the motif already
   used for an open repository in the library. */
const BANNER =
  "flex flex-none items-center gap-4 border-b border-b-border border-l-[3px] " +
  "border-l-accent bg-accent-soft px-6 py-3 animate-drop-in";

/* Baseline, not centre: the title and the smaller note share a line, and
   centring two different sizes leaves neither of them level. */
const TEXT = "flex min-w-0 items-baseline gap-4";
const TITLE = "flex-none font-semibold";

/* The note is what gets cut when the window is narrow. The version in the title
   is the part that cannot be guessed from anywhere else. */
const NOTES = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-small text-text-dim";

const ACTIONS = "ml-auto flex flex-none gap-3";
const ACTION = "px-4 py-[3px] text-small whitespace-nowrap";

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
    <div className={BANNER} role="status">
      {stage.state === "available" && (
        <>
          <span className={TEXT}>
            <span className={TITLE}>Version {stage.version} is available</span>
            {stage.notes && <span className={NOTES}>{summarise(stage.notes)}</span>}
          </span>

          <div className={ACTIONS}>
            <button className={`btn ${ACTION}`} onClick={onDismiss}>
              Not now
            </button>
            <button className={`btn-primary ${ACTION}`} onClick={onInstall}>
              Download and install
            </button>
          </div>
        </>
      )}

      {stage.state === "downloading" && (
        <>
          <span className={TEXT}>
            <span className={TITLE}>Downloading {stage.version}</span>
            <span className={NOTES}>
              {stage.percent === null
                ? "The server did not report a size, so there is no progress to show."
                : `${stage.percent}%`}
            </span>
          </span>

          {stage.percent !== null && (
            <span
              className="ml-auto h-3 w-80 flex-none overflow-hidden rounded-sm bg-surface"
              aria-hidden="true"
            >
              <span
                className="block h-full rounded-sm bg-accent transition-[width] duration-[120ms] ease-linear"
                style={{ width: `${stage.percent}%` }}
              />
            </span>
          )}
        </>
      )}

      {stage.state === "ready" && (
        <>
          <span className={TEXT}>
            <span className={TITLE}>Version {stage.version} is ready</span>
            <span className={NOTES}>
              It takes effect when the app restarts. Commit anything in progress first.
            </span>
          </span>

          <div className={ACTIONS}>
            <button className={`btn ${ACTION}`} onClick={onDismiss}>
              Later
            </button>
            <button className={`btn-primary ${ACTION}`} onClick={onRestart}>
              Restart now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
