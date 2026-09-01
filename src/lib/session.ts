/** When the open tabs are worth writing down.
 *
 *  The session file is the only record of which repositories were open. A
 *  window that has not established its tabs yet does not write *nothing* to it
 *  -- it erases what was there, and the only copy is gone.
 *
 *  This is separate from the dialog and the effects that use it because it is
 *  the rule, and the rule is what was wrong: turning "reopen repositories" off
 *  skipped the restore, marked startup finished anyway, and the very first
 *  write emptied the file.
 */

/** Has this window had a tab yet?
 *
 *  Latched on purpose. Once there has been one, closing the last is a
 *  deliberate empty state and worth storing; before that, empty only means the
 *  window has not got there yet.
 */
export function everHadTabs(already: boolean, tabCount: number): boolean {
  return already || tabCount > 0;
}

export function mayWriteSession(state: {
  /** Startup has finished, whether or not it restored anything. */
  settled: boolean;
  /** The result of `everHadTabs`. */
  hadTabs: boolean;
}): boolean {
  return state.settled && state.hadTabs;
}
