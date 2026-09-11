import type { Token } from "../lib/highlight";
import type { Range } from "../lib/intraline";

/** One line of code, coloured if we have tokens for it.
 *
 *  Falls back to the raw text rather than nothing, so a file in a language
 *  Prism does not know — or one too large to tokenize — still reads normally
 *  instead of coming up blank.
 *
 *  `marks` are the stretches that differ from the line's counterpart in a
 *  diff. They are drawn as a wrapper around the pieces of text they cover,
 *  cutting a syntax token where a mark starts or ends inside it, so the
 *  colour of the code and the emphasis of the change are two separate
 *  layers rather than one fighting the other. */
export function Code({
  tokens,
  text,
  marks,
}: {
  tokens?: Token[];
  text: string;
  marks?: Range[];
}) {
  if (!marks || marks.length === 0) return <Plain tokens={tokens} text={text} />;

  const pieces = tokens ?? [{ text }];
  const out: React.ReactNode[] = [];
  let at = 0;
  let key = 0;

  for (const token of pieces) {
    const end = at + token.text.length;
    // Every boundary a mark puts inside this token, in order.
    const cuts = new Set<number>([at, end]);
    for (const mark of marks) {
      if (mark.start > at && mark.start < end) cuts.add(mark.start);
      if (mark.end > at && mark.end < end) cuts.add(mark.end);
    }
    const stops = [...cuts].sort((a, b) => a - b);

    for (let n = 0; n < stops.length - 1; n++) {
      const from = stops[n]!;
      const to = stops[n + 1]!;
      const slice = text.slice(from, to);
      const lit = marks.some((mark) => mark.start <= from && mark.end >= to);

      const inner = token.type ? (
        <span key={key++} className={`token ${token.type}`}>
          {slice}
        </span>
      ) : (
        <span key={key++}>{slice}</span>
      );

      out.push(
        lit ? (
          <span key={key++} className="diff-mark">
            {inner}
          </span>
        ) : (
          inner
        ),
      );
    }

    at = end;
  }

  return <>{out}</>;
}

function Plain({ tokens, text }: { tokens?: Token[]; text: string }) {
  if (!tokens) return <>{text}</>;

  return (
    <>
      {tokens.map((token, index) =>
        token.type ? (
          <span key={index} className={`token ${token.type}`}>
            {token.text}
          </span>
        ) : (
          <span key={index}>{token.text}</span>
        ),
      )}
    </>
  );
}
