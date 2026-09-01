/** Release notes are written for GitHub, which renders them. The banner has one
 *  line and renders nothing, so the markup has to come off before it is shown.
 *
 *  Not a markdown parser and not trying to be. The notes come from our own
 *  release workflow, so the job is narrow: take the first line that actually
 *  says something and strip the punctuation that only meant something to a
 *  renderer. Anything it does not recognise is left alone, which is the right
 *  failure — a stray asterisk reads better than a swallowed sentence.
 */

const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const CODE = /`([^`]+)`/g;
const STRONG = /(\*\*|__)(.+?)\1/g;
const EMPHASIS = /(\*|_)(.+?)\1/g;
const COMMENT = /<!--[\s\S]*?-->/g;

const HEADING = /^\s*#{1,6}\s+/;
const BULLET = /^\s*(?:[-*+]|\d+\.)\s+/;
const QUOTE = /^\s*>\s?/;
/** `---`, `***` or `___` on a line of its own. */
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** Strip the markup from one line and tidy its whitespace. */
function plain(line: string): string {
  return line
    .replace(COMMENT, "")
    .replace(IMAGE, "")
    .replace(LINK, "$1")
    .replace(CODE, "$1")
    .replace(STRONG, "$2")
    .replace(EMPHASIS, "$2")
    .replace(QUOTE, "")
    .replace(BULLET, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first line of some release notes, as one line of plain text.
 *
 *  Headings are skipped rather than shown: "What's new" is what every set of
 *  notes is, so it tells the reader nothing they did not get from the title.
 *  One is used only if the notes turn out to be nothing else.
 */
export function summarise(notes: string): string {
  let heading = "";

  for (const line of notes.split("\n")) {
    if (RULE.test(line)) continue;

    const isHeading = HEADING.test(line);
    const text = plain(line.replace(HEADING, ""));
    if (text === "") continue;

    if (isHeading) {
      heading ||= text;
      continue;
    }

    return text;
  }

  return heading;
}
