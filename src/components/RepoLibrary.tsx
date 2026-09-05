import { useEffect, useMemo, useState } from 'react'

import { displayName, samePath, type Bookmark } from '../lib/library'
import { useCommands } from '../lib/useCommands'
import { FilterInput, matchesFilter } from './FilterInput'
import { useTip } from './Tip'

interface Props {
  repos: Bookmark[]
  /** Paths that already have a tab open. */
  openPaths: string[]
  /** False while something else holds the keyboard, such as a dialog. */
  keyboardActive: boolean
  onOpen: (path: string) => void
  onEdit: (path: string) => void
  onRemove: (path: string) => void
  onAdd: () => void
  onCreate: () => void
  onClone: () => void
  /** Repositories that were open when the app last closed, offered because
   *  "reopen on launch" is off. Empty when there is nothing to offer. */
  lastSession: string[]
  onReopen: () => void
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
/* Offered rather than done. The preference says not to reopen them, and
   quietly doing it anyway would make the setting a lie -- but leaving no trace
   of a previous session made losing it look like the app forgetting. */
const RESUME =
  'mt-6 flex flex-none items-center gap-4 rounded-sm border border-border ' +
  'bg-surface-alt px-4 py-3 text-small text-text-dim'

const FRAME = 'flex min-h-0 flex-1 flex-col bg-surface outline-none'

/* Capped and centred: a list of five paths across a 2500px window is a line of
   text with a screen of nothing beside it. */
const COLUMN = 'mx-auto flex min-h-0 w-full max-w-[880px] flex-1 flex-col px-8 pt-12'

const EMPTY = 'mx-auto grid max-w-[44ch] place-content-center justify-items-center gap-3 text-center'

const LIST = 'mt-6 mb-0 min-h-0 flex-1 list-none overflow-y-auto p-0'

/* `group` so the row can light its own actions and the name inside it. */
const ROW = 'group flex items-stretch gap-4 border-b border-b-border-soft hover:bg-surface-alt'

/** The lane the app is named for, lit where a tab is open on the repository.
 *  It says the one thing about a row that is not already written across it. */
const LANE = 'my-3 w-[3px] flex-none rounded-[2px]'

const BODY = 'grid min-w-0 flex-1 gap-px py-4 bg-transparent border-0 [font:inherit] ' + 'text-left cursor-pointer'

const NAME = 'overflow-hidden text-ellipsis whitespace-nowrap font-medium text-text ' + 'group-hover:text-accent'

const PATH = 'overflow-hidden text-ellipsis whitespace-nowrap font-mono text-micro text-text-faint'

const ACTION =
  'p-0 bg-transparent border-0 [font:inherit] text-small text-text-faint cursor-pointer ' +
  'group-hover:text-text-dim hover:underline'

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
  lastSession,
  onReopen
}: Props) {
  const [filter, setFilter] = useState('')
  const [cursor, setCursor] = useState(0)
  const tip = useTip()

  const shown = useMemo(
    () => repos.filter((repo) => matchesFilter(displayName(repo), filter) || matchesFilter(repo.path, filter)),
    [repos, filter]
  )

  // A list that shrank under the cursor pulls it back into range rather than
  // leaving the selection pointing at nothing.
  useEffect(() => {
    setCursor((at) => Math.min(at, Math.max(shown.length - 1, 0)))
  }, [shown.length])

  const selected = shown[cursor]

  useEffect(() => {
    if (!selected) return
    document.querySelector(`[data-repo="${CSS.escape(selected.path)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const move = (delta: number) => setCursor((at) => Math.min(Math.max(at + delta, 0), Math.max(shown.length - 1, 0)))

  useCommands(
    {
      'library.next': () => move(1),
      'library.previous': () => move(-1),
      'library.open': () => selected && onOpen(selected.path),
      'library.edit': () => selected && onEdit(selected.path),
      'library.remove': () => selected && onRemove(selected.path)
    },
    keyboardActive
  )

  return (
    <div className={FRAME}>
      <div className={COLUMN}>
        <header className="flex flex-none items-baseline gap-4">
          <h1 className="m-0 text-[17px] font-semibold tracking-[0.01em]">Repositories</h1>
          {repos.length > 0 && <span className="font-mono text-small text-text-faint">{repos.length}</span>}

          <div className="ml-auto flex gap-3">
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

        {/* Only while nothing is open. Once a tab exists the offer has been
            answered one way or another, and a standing "reopen" would keep
            asking a question already settled. */}
        {lastSession.length > 0 && openPaths.length === 0 && (
          <div className={RESUME}>
            <span>
              {lastSession.length === 1
                ? '1 repository was open when you last closed Braid.'
                : `${lastSession.length} repositories were open when you last closed Braid.`}
            </span>
            <button className="btn" onClick={onReopen}>
              Reopen {lastSession.length === 1 ? 'it' : 'them'}
            </button>
          </div>
        )}

        {repos.length === 0 ? (
          <div className={EMPTY}>
            <p className="m-0 text-lead text-text">Nothing on the shelf yet.</p>
            <p className="m-0 text-small text-text-faint">
              Open a folder you already have, clone one from a URL, or create one from scratch. Everything you add stays
              here, so closing a tab never loses it.
            </p>
          </div>
        ) : (
          <>
            {repos.length > 6 && (
              <div className="mt-8 mb-3 max-w-xs flex-none">
                <FilterInput
                  value={filter}
                  onChange={setFilter}
                  name="library"
                  placeholder="Filter by name or path"
                  matches={shown.length}
                />
              </div>
            )}

            <ul className={LIST}>
              {shown.map((repo, index) => {
                const open = openPaths.some((path) => samePath(path, repo.path))

                return (
                  <li
                    key={repo.path}
                    data-repo={repo.path}
                    className={[ROW, index === cursor && 'bg-surface-alt shadow-[inset_0_0_0_1px_var(--color-accent)]']
                      .filter(Boolean)
                      .join(' ')}
                    onMouseEnter={() => setCursor(index)}
                  >
                    <span
                      className={`${LANE} ${open ? 'bg-accent' : 'bg-border'}`}
                      {...tip(open ? 'Open in a tab' : 'Not open')}
                      aria-hidden
                    />

                    {/* The whole row opens it. Two lines rather than one, so a
                        long path never crowds the name out of its own row. */}
                    <button
                      className={BODY}
                      onClick={() => onOpen(repo.path)}
                      {...tip(open ? 'Go to its tab' : 'Open in a new tab')}
                    >
                      <span className={NAME}>{displayName(repo)}</span>
                      <span className={PATH}>{repo.path}</span>
                    </button>

                    {/* Shown at rest. Hiding these meant the two things this
                        screen exists for could only be found by accident. */}
                    <div className="flex flex-none items-center gap-6 pr-4">
                      <button
                        className={`${ACTION} hover:text-accent`}
                        {...tip('Edit', 'library.edit', 'Its name, or the folder it points at')}
                        onClick={() => onEdit(repo.path)}
                      >
                        Edit
                      </button>
                      <button
                        className={`${ACTION} hover:text-removed`}
                        {...tip('Remove', 'library.remove', 'Off this list only — the folder is left alone')}
                        onClick={() => onRemove(repo.path)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}

              {shown.length === 0 && <li className="py-6 text-text-faint">Nothing matches “{filter}”.</li>}
            </ul>
          </>
        )}
      </div>

    </div>
  )
}
