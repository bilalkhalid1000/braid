import { useTip } from "./Tip";

interface Props {
  /** The abbreviation to show. The full hash is what gets copied -- a short
   *  hash is for reading, and pasting one into a command is how you find out
   *  it was ambiguous. */
  short: string;
  copied: boolean;
  onCopy: () => void;
  /** Bordered treatment, for where the hash stands alone rather than sitting
   *  in a column of its own. */
  chip?: boolean;
}

const BASE = "cursor-pointer font-mono text-left";

const PLAIN = "border-0 bg-transparent p-0 text-small text-text-dim hover:text-accent";

const CHIP =
  "px-2 bg-surface-alt border border-border-soft rounded-sm text-micro text-text-dim " +
  "hover:border-accent hover:text-accent";

/** A commit hash you can click to copy.
 *
 *  Says so afterwards. A click that puts something on the clipboard with no
 *  acknowledgement is indistinguishable from a click that missed, and the only
 *  way to find out which happened is to paste somewhere and look. */
export function CopyHash({ short, copied, onCopy, chip }: Props) {
  const tip = useTip();

  return (
    <button
      className={[
        BASE,
        chip ? CHIP : PLAIN,
        // Colour rather than a swapped label: this sits in a fixed column, and
        // a word where a hash was would shift the row it is in.
        copied && (chip ? "border-added! text-added!" : "text-added!"),
      ]
        .filter(Boolean)
        .join(" ")}
      {...tip(copied ? "Copied" : "Copy the full hash")}
      onClick={onCopy}
    >
      {short}
    </button>
  );
}
