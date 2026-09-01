/** The dimmed field a modal sits on.
 *
 *  Shared rather than repeated: three things in the app open over the window --
 *  a dialog, the settings, the command palette -- and a scrim that differed
 *  between them would read as three different depths of "in front".
 */
export const SCRIM = "fixed inset-0 z-25 grid place-items-center bg-[rgb(10_14_20/42%)]";

/** For the palette, which belongs near the top of the window rather than in
 *  the middle: you are looking past it at the thing you are about to act on. */
export const SCRIM_TOP = "fixed inset-0 z-25 grid justify-items-center items-start pt-[14vh] bg-[rgb(10_14_20/42%)]";
