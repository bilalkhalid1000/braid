import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  axis: "x" | "y";
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  /** Layout from whoever placed it -- how it sits in its own parent is not
   *  something a divider can know. */
  className?: string;
  /** A wider grab area, for a divider sitting in a header where the rows above
   *  and below leave less room to aim at. */
  wide?: boolean;
}

/* A 1px divider is a 1px target, which is not one anybody can hit. The grab
   area is grown with a pseudo-element rather than with padding so the line
   itself stays hairline while what the pointer is aiming at does not. */
const GRIP = "after:absolute after:content-['']";

const BASE =
  "relative bg-border-soft transition-[background] duration-[90ms] hover:bg-accent " +
  GRIP;

/** Draggable pane divider.
 *
 *  Uses pointer capture rather than window listeners so a fast drag cannot
 *  outrun the handle and drop it, and so the drag survives passing over the
 *  webview's own scrollbars. Arrow keys move it too — a pane you can only
 *  resize with a mouse is a pane some people cannot resize. */
export function Splitter({ axis, value, onChange, min, max, className, wide }: Props) {
  const origin = useRef({ pointer: 0, value: 0 });
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback(
    (next: number) => Math.min(Math.max(next, min), max),
    [min, max],
  );

  return (
    <div
      className={[
        BASE,
        wide ? "after:inset-[0_-5px]" : "after:inset-[-3px]",
        axis === "x" ? "cursor-col-resize" : "cursor-row-resize",
        dragging && "bg-accent",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { pointer: axis === "x" ? e.clientX : e.clientY, value };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const pointer = axis === "x" ? e.clientX : e.clientY;
        onChange(clamp(origin.current.value + pointer - origin.current.pointer));
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 8;
        const back = axis === "x" ? "ArrowLeft" : "ArrowUp";
        const forward = axis === "x" ? "ArrowRight" : "ArrowDown";

        if (e.key === back) {
          e.preventDefault();
          onChange(clamp(value - step));
        }
        if (e.key === forward) {
          e.preventDefault();
          onChange(clamp(value + step));
        }
      }}
    />
  );
}

/** A pane size that survives restarts. Layout is a preference, not state. */
export function usePaneSize(key: string, initial: number) {
  const storageKey = `pane:${key}`;

  const [size, setSize] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : initial;
  });

  useEffect(() => {
    localStorage.setItem(storageKey, String(size));
  }, [storageKey, size]);

  return [size, setSize] as const;
}
