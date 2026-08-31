import type { ReactNode } from "react";

/** A key and what it does, kept together.
 *
 *  A hint is a row of these separated by dots, and a plain line of them wraps
 *  at any space — including the one between a key and its label, which strands
 *  a lone "close" on the next line describing nothing. Each pair is its own
 *  unbreakable run, so the line breaks between pairs instead.
 */
export function Keys({ children }: { children: ReactNode }) {
  return <span className="hint-pair">{children}</span>;
}
