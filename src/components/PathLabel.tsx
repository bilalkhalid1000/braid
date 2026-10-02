/* The directory is what gets cut first: shrinking ten thousand times as
   readily as the filename, it is gone before the filename gives up a
   character. */
const PATH_DIR =
  "min-w-0 shrink-[10000] basis-auto overflow-hidden text-ellipsis text-text-dim";

/** Left-to-right mark. See `PathLabel` on why the directory is wrapped in it. */
const LRM = "\u200E";

/* The filename is the part being named, so it is cut last -- but it is cut,
   with an ellipsis, when it alone is wider than the list. */
const PATH_NAME = "min-w-0 shrink overflow-hidden text-ellipsis";

/** The directory dimmed, the filename bright and truncated only once the
 *  directory is gone.
 *
 *  The directory shrinks first, and it loses characters from its front rather
 *  than its end — the part of a path nearest the file is the part that
 *  identifies it, and `AttendanceApp/dist/gui/` is far less useful than
 *  `…/dist/gui/`.
 *
 *  The front is cut by laying the directory out right to left, whose
 *  overflow end is the left. Its text is wrapped in left-to-right marks so
 *  the slashes, which have no direction of their own, stay where they are.
 *  This used `unicode-bidi: plaintext` for that, which takes the direction
 *  from the text -- a path is Latin, so it undid the right-to-left, and the
 *  directory was cut at its end: `e2e/tests/school/…auth-page.spec.ts`.
 *
 *  Put it in a flex row that clips and may shrink (`flex min-w-0
 *  overflow-hidden whitespace-nowrap`); the two parts share out the width
 *  between them. */
export function PathLabel({ path }: { path: string }) {
  const cut = path.lastIndexOf("/");
  if (cut === -1) return <span className={PATH_NAME}>{path}</span>;

  return (
    <>
      <span className={PATH_DIR} dir="rtl">
        {LRM + path.slice(0, cut + 1) + LRM}
      </span>
      <span className={PATH_NAME}>{path.slice(cut + 1)}</span>
    </>
  );
}
