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
  /** Why the button is unavailable, when it is. */
  disabledReason?: string;
}

interface Props {
  /** Each inner array renders as a group, separated by a rule. */
  groups: ToolbarAction[][];
}

export function Toolbar({ groups }: Props) {
  const tip = useTip();

  return (
    <div className="toolbar">
      {groups.map((group, i) => (
        <div className="toolbar-group" key={i}>
          {group.map((action) => (
            <button
              key={action.key}
              className={`toolbar-button ${action.primary ? "toolbar-button-primary" : ""}`}
              onClick={action.onClick}
              disabled={action.disabled}
              aria-label={action.label}
              {...tip(
                action.label,
                action.commandId,
                action.disabled ? action.disabledReason : undefined,
              )}
            >
              <span className="toolbar-icon">
                {action.icon}
                {action.badge ? <span className="toolbar-badge">{action.badge}</span> : null}
              </span>
              <span className="toolbar-label">{action.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
