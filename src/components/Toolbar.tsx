import type { MouseEvent, ReactNode } from "react";

import { useTip } from "./Tip";

export interface ToolbarAction {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: (event: MouseEvent) => void;
  disabled?: boolean;
  /** Small count on the corner of the button, as on Pull and Push. */
  badge?: number;
  /** Filled treatment. Reserved for the one action the current state is
   *  asking for, so the toolbar has a subject rather than twelve equals. */
  primary?: boolean;
  /** Command this button runs, so its tip can show the key. */
  commandId?: string;
  /** Its operation is running. The button says so and refuses a second go. */
  busy?: boolean;
  /** Why the button is unavailable, when it is. */
  disabledReason?: string;
}

interface Props {
  /** Each inner array renders as a group, separated by a rule. */
  groups: ToolbarAction[][];
}

const BAR = "flex flex-none items-stretch h-[54px] px-3 bg-chrome border-b border-b-border";

const BUTTON =
  "flex flex-col items-center justify-center gap-1 min-w-[60px] mx-1 my-3 px-4 py-2 " +
  "bg-transparent border border-transparent rounded-sm text-text cursor-pointer " +
  "enabled:hover:bg-surface enabled:hover:border-border-soft " +
  "disabled:text-text-faint disabled:cursor-default disabled:opacity-55";

const PRIMARY =
  "bg-accent border-accent text-white enabled:hover:bg-accent " +
  "enabled:hover:border-accent enabled:hover:brightness-[1.08]";

/* A running button stays at full strength: it is not unavailable, it is busy,
   and fading it would say the wrong thing about why it cannot be pressed. */
const BUSY = "disabled:opacity-100 disabled:text-text-dim";

const BADGE =
  "absolute -top-[5px] -right-[9px] min-w-[15px] px-2 rounded-full " +
  "font-mono text-micro leading-[15px] text-center";

export function Toolbar({ groups }: Props) {
  const tip = useTip();

  return (
    <div className={BAR}>
      {groups.map((group, i) => (
        <div
          className={`flex items-stretch px-6 ${i > 0 ? "border-l border-l-border-soft" : ""}`}
          key={i}
        >
          {group.map((action) => (
            <button
              key={action.key}
              className={[BUTTON, action.primary && PRIMARY, action.busy && BUSY]
                .filter(Boolean)
                .join(" ")}
              onClick={action.onClick}
              // Disabled while it runs: a second Push before the first has
              // answered is never what was meant, and git would take the lock
              // and fail anyway.
              disabled={action.disabled || action.busy}
              aria-busy={action.busy}
              aria-label={action.label}
              {...tip(
                action.label,
                action.commandId,
                action.disabled ? action.disabledReason : undefined,
              )}
            >
              <span
                className={
                  action.busy
                    ? "relative flex size-10 items-center justify-center leading-[0]"
                    : "relative block leading-[0]"
                }
              >
                {/* The spinner takes the icon's place rather than sitting
                    beside it, so nothing on the bar moves while it runs. */}
                {action.busy ? <span className="spinner size-7" /> : action.icon}
                {!action.busy && action.badge ? (
                  <span
                    className={`${BADGE} ${
                      action.primary ? "bg-white text-accent" : "bg-accent text-white"
                    }`}
                  >
                    {action.badge}
                  </span>
                ) : null}
              </span>
              <span className="text-small">{action.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
