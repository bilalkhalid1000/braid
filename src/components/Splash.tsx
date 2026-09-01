import { channelLabel, type Channel } from "../lib/version";

interface Props {
  /** What the app is waiting on, in the user's terms. */
  status: string;
  channel: Channel;
}

/** The window while the app is still coming up.
 *
 *  The mark draws itself: the trunk, then a lane out and back, then the commits
 *  — the same construction as the app icon and the history view, because the
 *  lane graph is the thing this client is built around. A generic spinner would
 *  have said only "wait"; this says what you are waiting for.
 *
 *  The geometry is normalized with `pathLength`, so the dash animation is
 *  written in fractions of each path rather than in the pixel lengths of two
 *  curves that are not the same length.
 */
export function Splash({ status, channel }: Props) {
  return (
    <div className="splash" role="status" aria-busy="true">
      <div className="splash-block">
        <svg className="splash-mark" viewBox="0 0 1024 1024" aria-hidden>
          <g fill="none" strokeWidth="74" strokeLinecap="round">
            <path
              className="splash-trunk"
              pathLength={1}
              d="M 392 142 L 392 882"
              stroke="#4d8dff"
            />
            <path
              className="splash-lane"
              pathLength={1}
              d="M 392 212 C 392 312, 632 312, 632 412
                 L 632 612
                 C 632 712, 392 712, 392 812"
              stroke="#e8459b"
            />
          </g>

          <circle className="splash-dot splash-dot-1" cx="392" cy="212" r="74" fill="#4d8dff" />
          <circle className="splash-dot splash-dot-2" cx="632" cy="512" r="74" fill="#e8459b" />
          {/* The merge is a ring, exactly as history draws one. */}
          <circle
            className="splash-dot splash-dot-3"
            cx="392"
            cy="812"
            r="74"
            fill="var(--surface)"
            stroke="#4d8dff"
            strokeWidth="44"
          />
        </svg>

        <h1 className="splash-name">
          Braid
          {channel && (
            <span className={`channel channel-${channel}`}>{channelLabel(channel)}</span>
          )}
        </h1>

        <p className="splash-status">{status}</p>
      </div>
    </div>
  );
}
