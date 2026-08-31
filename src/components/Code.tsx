import type { Token } from "../lib/highlight";

/** One line of code, coloured if we have tokens for it.
 *
 *  Falls back to the raw text rather than nothing, so a file in a language
 *  Prism does not know — or one too large to tokenize — still reads normally
 *  instead of coming up blank. */
export function Code({ tokens, text }: { tokens?: Token[]; text: string }) {
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
