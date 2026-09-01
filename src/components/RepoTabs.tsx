import { useRef, useState } from "react";

import type { RepoInfo } from "../lib/api";
import { landingIndex } from "../lib/tabOrder";
import { LIBRARY_TAB } from "../lib/library";
import { useTip } from "./Tip";

/** How far the pointer moves before a press becomes a drag.
 *
 *  Without it every click is a one-pixel drag and the tab you meant to select
 *  twitches as you release. */
const THRESHOLD = 5;

interface Drag {
  id: string;
  from: number;
  /** Where it would land if released now. */
  to: number;
  /** Pointer travel since the press, in pixels. */
  dx: number;
}

/** Tab positions as they were when the drag began.
 *
 *  Measured once. Nothing in the DOM moves until the drag commits, so these
 *  stay true for its whole duration — which is the point: read live, they would
 *  describe a strip that is already shifting under the pointer. */
interface Geometry {
  lefts: number[];
  widths: number[];
  min: number;
  max: number;
}

interface Props {
  repos: RepoInfo[];
  activeId: string | null;
  /** True while a modifier is held, which reveals the jump numbers. */
  modHeld: boolean;
  digitFor: (index: number) => number | null;
  commandFor: (index: number) => string | undefined;
  onAdd: (event: React.MouseEvent) => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  /** Right-click on a tab, at that point. */
  onMenu: (id: string, at: { x: number; y: number }) => void;
}

/** The repository tabs, rearranged by dragging.
 *
 *  A tab lifts out of the strip and the strip holds its lane open: the tabs it
 *  passes slide aside by exactly its width, and the gap that follows the
 *  pointer is where it will land. That gap is the whole indicator — a marker
 *  line drawn on top would say the same thing twice in a strip this short.
 *
 *  The order in the DOM does not change until the drag ends. Reordering as it
 *  went would move the tab out from under the pointer and straight back again,
 *  which reads as a flicker and is one of the ways this kind of drag goes
 *  wrong; here it cannot happen, because there is nothing to oscillate.
 */
export function RepoTabs({
  repos,
  activeId,
  modHeld,
  digitFor,
  commandFor,
  onAdd,
  onSelect,
  onClose,
  onReorder,
  onMenu,
}: Props) {
  const tip = useTip();
  const strip = useRef<HTMLDivElement>(null);
  const start = useRef({ x: 0, index: -1 });
  const geometry = useRef<Geometry | null>(null);
  /** Set by a completed drag so the click that follows it does not also
   *  switch repository: moving a tab is arranging, not choosing. */
  const moved = useRef(false);

  const [drag, setDrag] = useState<Drag | null>(null);

  const measure = (index: number): Geometry | null => {
    const tabs = strip.current?.querySelectorAll<HTMLElement>("[data-tab]");
    if (!tabs || tabs.length === 0) return null;

    const boxes = Array.from(tabs, (tab) => tab.getBoundingClientRect());
    const first = boxes[0]!;
    const last = boxes[boxes.length - 1]!;
    const own = boxes[index]!;

    return {
      lefts: boxes.map((b) => b.left),
      widths: boxes.map((b) => b.width),
      // How far it may travel before its edges leave the run of tabs.
      min: first.left - own.left,
      max: last.right - own.right,
    };
  };

  /** How far a tab is pushed aside to open the lane. */
  const shift = (index: number) => {
    if (!drag || !geometry.current) return 0;

    const { from, to } = drag;
    const width = geometry.current.widths[from]!;

    if (index === from) return drag.dx;
    if (from < to && index > from && index <= to) return -width;
    if (from > to && index >= to && index < from) return width;

    return 0;
  };

  const stop = () => {
    start.current = { x: 0, index: -1 };
    geometry.current = null;
    setDrag(null);
  };

  return (
    <div className="tab-strip" ref={strip}>
      {repos.map((repo, index) => {
        const offset = shift(index);
        // Spread first, then overridden below: the tab needs the tip's own
        // dismiss-on-press *and* its drag, and a bare spread would silently
        // replace one with the other.
        const shelf = repo.id === LIBRARY_TAB;
        // The list has no path to describe, so its tip says what it is.
        const tipProps = shelf
          ? tip("Every repository you have added", "repo.library")
          : tip(repo.root, commandFor(index));
        const closeTip = tip("Close repository", "repo.close");

        return (
          <div
            key={repo.id}
            data-tab={repo.id}
            className={[
              "tab",
              repo.id === activeId && "tab-active",
              shelf && "tab-shelf",
              drag?.id === repo.id && "tab-lifted",
              drag && drag.id !== repo.id && "tab-yielding",
            ]
              .filter(Boolean)
              .join(" ")}
            style={offset ? { transform: `translateX(${offset}px)` } : undefined}
            {...tipProps}
            onClick={() => {
              if (moved.current) {
                moved.current = false;
                return;
              }
              onSelect(repo.id);
            }}
            onPointerDown={(e) => {
              tipProps.onPointerDown();

              // Left button only: right is a menu and middle is a close in
              // every other tabbed thing.
              if (e.button !== 0) return;

              e.currentTarget.setPointerCapture(e.pointerId);
              start.current = { x: e.clientX, index };
            }}
            onPointerMove={(e) => {
              const { x, index: from } = start.current;
              if (from === -1) return;

              const travel = e.clientX - x;
              if (!drag && Math.abs(travel) < THRESHOLD) return;

              const g = geometry.current ?? measure(from);
              if (!g) return;
              geometry.current = g;

              // Held inside the run of tabs: a tab dragged past the end has
              // nowhere further to go, and letting it slide out over the
              // window would suggest it does.
              const dx = Math.min(Math.max(travel, g.min), g.max);

              setDrag({
                id: repo.id,
                from,
                to: landingIndex(g.lefts, g.widths, from, dx),
                dx,
              });
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);

              if (drag && drag.to !== drag.from) {
                moved.current = true;
                onReorder(drag.from, drag.to);
              } else if (drag) {
                // Dragged and put back. Still a drag, so it should not also
                // change which repository is showing.
                moved.current = true;
              }

              stop();
            }}
            // A drag that ends off the strip must not leave a tab lifted.
            onPointerCancel={stop}
            onContextMenu={(e) => {
              e.preventDefault();
              onMenu(repo.id, { x: e.clientX, y: e.clientY });
            }}
          >
            {modHeld && digitFor(index) !== null && (
              <kbd className="tab-key">{digitFor(index)}</kbd>
            )}

            <span className="tab-name">{repo.name}</span>

            <span
              className="tab-close"
              {...closeTip}
              onPointerDown={(e) => {
                closeTip.onPointerDown();
                // Not a drag handle: grabbing the × should not pick the tab up.
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onClose(repo.id);
              }}
            >
              &times;
            </span>
          </div>
        );
      })}

      {/* Inside the strip, so it stays at the end of the tabs rather than
          floating in place while they scroll past it. */}
      <button
        className="tab tab-add"
        {...tip("Open or create a repository", "repo.open")}
        onClick={onAdd}
      >
        +
      </button>
    </div>
  );
}
