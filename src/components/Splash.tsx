import { channelLabel, type Channel } from "../lib/version";

interface Props {
  /** What the app is waiting on, in the user's terms. */
  status: string;
  channel: Channel;
  /** Shown small and last. Worth having on screen during an alpha, when the
   *  first question about odd behaviour is which build it is. */
  version?: string;
}

/* A wash behind the mark rather than a flat field. The window it hands over to
   is not one colour either, and a splash that is makes the reveal a flash. */
const SCREEN =
  "grid h-full select-none place-content-center justify-items-center gap-6 " +
  "bg-surface bg-[radial-gradient(ellipse_at_center,var(--color-surface-alt),var(--color-surface)_70%)]";

/* Every stroke is drawn from nothing, so both paths need a dash the length of
   themselves. pathLength normalises that to 1, which is why the animation can
   be written in fractions rather than in the pixel lengths of two curves that
   are not the same length. */
const STROKE =
  "[stroke-dasharray:1] [stroke-dashoffset:1] animate-splash-draw " +
  // Held complete rather than held empty: switching the animation off without
  // this leaves the offset at its starting value, which is a blank square.
  "motion-reduce:animate-none motion-reduce:[stroke-dashoffset:0]";

/* Reduced motion gets the finished drawing rather than no drawing: the marks
   are how the screen says which app you are waiting for. */
const DOT =
  "opacity-0 [transform-box:fill-box] [transform-origin:center] animate-splash-dot " +
  "motion-reduce:animate-none motion-reduce:opacity-100";

/** The window while the app is still coming up.
 *
 *  A generic spinner would have said only "wait"; this says what you are
 *  waiting for, and the bar underneath says it is still going. */
export function Splash({ status, channel, version }: Props) {
  return (
    <div className={SCREEN} role="status" aria-busy="true">
      <svg className="size-24" viewBox="0 0 1024 1024" aria-hidden>
        <g fill="none" strokeWidth="74" strokeLinecap="round">
          <path className={STROKE} pathLength={1} d="M 392 142 L 392 882" stroke="#4d8dff" />
          <path
            className={`${STROKE} [animation-delay:0.28s]`}
            pathLength={1}
            d="M 392 212 C 392 312, 632 312, 632 412
               L 632 612
               C 632 712, 392 712, 392 812"
            stroke="#e8459b"
          />
        </g>

        <circle className={`${DOT} [animation-delay:0.35s]`} cx="392" cy="212" r="74" fill="#4d8dff" />
        <circle className={`${DOT} [animation-delay:0.75s]`} cx="632" cy="512" r="74" fill="#e8459b" />
        {/* The merge is a ring, exactly as history draws one. */}
        <circle
          className={`${DOT} [animation-delay:1.05s]`}
          cx="392"
          cy="812"
          r="74"
          fill="var(--color-surface)"
          stroke="#4d8dff"
          strokeWidth="44"
        />
      </svg>

      <div className="grid justify-items-center gap-3 text-center">
        <h1 className="m-0 flex items-center gap-4 text-display font-medium tracking-[0.01em]">
          Braid
          {channel && <span className={`channel channel-${channel}`}>{channelLabel(channel)}</span>}
        </h1>

        {/* Body size, not the smallest one available. This is the only line on
            screen saying what is being waited for, and it used to be set in the
            faintest colour the app has. */}
        <p className="m-0 text-body text-text-dim" aria-live="polite">
          {status}
        </p>
      </div>

      {/* Fixed width so the layout does not move as the wording changes. */}
      <div className="h-1 w-64 overflow-hidden rounded-sm bg-chrome-alt" aria-hidden>
        <div className="h-full w-1/3 rounded-sm bg-accent animate-sweep motion-reduce:animate-none" />
      </div>

      {version && <p className="m-0 -mt-2 text-micro text-text-faint">{version}</p>}
    </div>
  );
}
