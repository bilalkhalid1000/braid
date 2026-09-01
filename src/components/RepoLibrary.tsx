import { useEffect, useMemo, useState } from "react";

import { displayName, samePath, type Bookmark } from "../lib/library";
import { useCommands } from "../lib/useCommands";
import { useSettings } from "../lib/settings";
import { shortcutLabel } from "../lib/shortcutLabel";
import { FilterInput, matchesFilter } from "./FilterInput";
import { Keys } from "./Keys";

interface Props {
  repos: Bookmark[];
  /** Paths that already have a tab open. */
  openPaths: string[];
  /** False while something else holds the keyboard, such as a dialog. */
  keyboardActive: boolean;
  onOpen: (path: string) => void;
  onEdit: (path: string) => void;
  onRemove: (path: string) => void;
  onAdd: () => void;
  onCreate: () => void;
  onClone: () => void;
}

/** Every repository you have added, whether or not a tab is open on it.
 *
 *  What an empty window shows, and a tab of its own once opened. Closing the
 *  last repository is a normal thing to do, and having to hunt through the
 *  filesystem afterwards is why people leave tabs open they are not using.
 *
 *  Each row carries a lane down its left edge — lit where a tab is open on it,
 *  faint where none is. It is the lane the app is named for, and it says the
 *  one thing about a row that is not already written across it, which is why
 *  there is no "open" label as well.
 */
export function RepoLibrary({
  repos,
  openPaths,
  keyboardActive,
  onOpen,
  onEdit,
  onRemove,
  onAdd,
  onCreate,
  onClone,
}: Props) {
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);
  const { keymap } = useSettings();

  const shown = useMemo(
    () =>
      repos.filter(
        (repo) =>
          matchesFilter(displayName(repo), filter) || matchesFilter(repo.path, filter),
      ),
    [repos, filter],
  );

  // A list that shrank under the cursor pulls it back into range rather than
  // leaving the selection pointing at nothing.
  useEffect(() => {
    setCursor((at) => Math.min(at, Math.max(shown.length - 1, 0)));
  }, [shown.length]);

  const selected = shown[cursor];

  useEffect(() => {
    if (!selected) return;
    document
      .querySelector(`[data-repo="${CSS.escape(selected.path)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const move = (delta: number) =>
    setCursor((at) => Math.min(Math.max(at + delta, 0), Math.max(shown.length - 1, 0)));

  useCommands(
    {
      "library.next": () => move(1),
      "library.previous": () => move(-1),
      "library.open": () => selected && onOpen(selected.path),
      "library.edit": () => selected && onEdit(selected.path),
      "library.remove": () => selected && onRemove(selected.path),
    },
    keyboardActive,
  );

  return (
    <div className="library">
      <div className="library-column">
        <header className="library-head">
          <h1 className="library-title">Repositories</h1>
          {repos.length > 0 && <span className="library-count">{repos.length}</span>}

          <div className="library-actions">
            <button className="btn" onClick={onClone}>
              Clone
            </button>
            <button className="btn" onClick={onCreate}>
              Create
            </button>
            <button className="btn-primary" onClick={onAdd}>
              Open a folder
            </button>
          </div>
        </header>

        {repos.length === 0 ? (
          <div className="library-empty">
            <p className="library-empty-lead">Nothing on the shelf yet.</p>
            <p className="library-empty-hint">
              Open a folder you already have, clone one from a URL, or create one from
              scratch. Everything you add stays here, so closing a tab never loses it.
            </p>
          </div>
        ) : (
          <>
            {repos.length > 6 && (
              <div className="library-filter">
                <FilterInput
                  value={filter}
                  onChange={setFilter}
                  name="library"
                  placeholder="Filter by name or path"
                  matches={shown.length}
                />
              </div>
            )}

            <ul className="library-list">
              {shown.map((repo, index) => {
                const open = openPaths.some((path) => samePath(path, repo.path));

                return (
                  <li
                    key={repo.path}
                    data-repo={repo.path}
                    className={[
                      "library-row",
                      open && "library-row-open",
                      index === cursor && "library-row-cursor",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseEnter={() => setCursor(index)}
                  >
                    <span
                      className="library-lane"
                      title={open ? "Open in a tab" : "Not open"}
                      aria-hidden
                    />

                    {/* The whole row opens it. Two lines rather than one, so a
                        long path never crowds the name out of its own row. */}
                    <button
                      className="library-body"
                      onClick={() => onOpen(repo.path)}
                      title={open ? "Go to its tab" : "Open in a new tab"}
                    >
                      <span className="library-name">{displayName(repo)}</span>
                      <span className="library-path">{repo.path}</span>
                    </button>

                    {/* Shown at rest. Hiding these meant the two things this
                        screen exists for could only be found by accident. */}
                    <div className="library-row-actions">
                      <button
                        className="library-action"
                        title="Change its name or point it at a different folder"
                        onClick={() => onEdit(repo.path)}
                      >
                        Edit
                      </button>
                      <button
                        className="library-action library-action-danger"
                        title="Take it off this list. The folder itself is left alone."
                        onClick={() => onRemove(repo.path)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}

              {shown.length === 0 && (
                <li className="library-none">Nothing matches “{filter}”.</li>
              )}
            </ul>
          </>
        )}
      </div>

      {keyboardActive && repos.length > 0 && (
        <p className="pane-hint">
          <Keys>
            <kbd>{shortcutLabel(keymap["library.next"])}</kbd>
            <kbd>{shortcutLabel(keymap["library.previous"])}</kbd> move
          </Keys>{" "}
          ·{" "}
          <Keys>
            <kbd>{shortcutLabel(keymap["library.open"])}</kbd> open
          </Keys>{" "}
          ·{" "}
          <Keys>
            <kbd>{shortcutLabel(keymap["library.edit"])}</kbd> edit
          </Keys>{" "}
          ·{" "}
          <Keys>
            <kbd>{shortcutLabel(keymap["library.remove"])}</kbd> remove
          </Keys>
        </p>
      )}
    </div>
  );
}
