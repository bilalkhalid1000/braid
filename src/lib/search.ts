/** When a typed query is worth asking git about.
 *
 *  Kept apart from the view so the rule can be stated once and checked, rather
 *  than living inside an effect where it reads as an arbitrary number.
 */

/** How long typing has to stop before git is asked.
 *
 *  A search is a `git log` walk or a `git grep` over the whole repository:
 *  cheap once, wasteful on every keystroke. Long enough that typing a word
 *  makes one search rather than five, short enough that it still feels like it
 *  is keeping up with you.
 */
export const SETTLE_MS = 300;

/** Shorter than this and we do not ask.
 *
 *  One character matches most of a repository, so it is simultaneously the
 *  most expensive search to run and the least useful to read -- and it is a
 *  guaranteed stop on the way to typing anything longer.
 */
export const MIN_QUERY = 2;

/** Whether this query is worth running. */
export const searchable = (query: string) => query.trim().length >= MIN_QUERY;
