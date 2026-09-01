import { useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Shown when a filter is active, so a short list never looks like a bug. */
  matches?: number;
  /** Names this box so the "focus the filter" command can find the one that
   *  belongs to whatever is in front. */
  name?: string;
  /** Layout from whoever placed it. The box has no opinion about how wide it
   *  should be -- in a toolbar it takes the free space, in a sidebar it does
   *  not -- and that is the caller's business rather than a variant here. */
  className?: string;
}

const BOX =
  "flex items-center gap-3 rounded-sm border border-border bg-surface px-3 " +
  "focus-within:border-accent";

const INPUT =
  "h-row min-w-0 flex-1 border-0 bg-transparent text-body outline-none " +
  "placeholder:text-text-faint";

export function FilterInput({ value, onChange, placeholder, matches, name, className }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className={className ? `${BOX} ${className}` : BOX}>
      <input
        ref={ref}
        className={INPUT}
        data-filter={name}
        type="search"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            // Clear on the first press, release focus on the second.
            if (value) onChange("");
            else ref.current?.blur();
          }
        }}
      />
      {value && <span className="font-mono text-micro text-text-faint">{matches ?? 0}</span>}
    </div>
  );
}

/** Case-insensitive substring match, the behaviour people expect from a box
 *  labelled "Filter". Fuzzy matching surprises more often than it helps here,
 *  because branch names are typed from memory. */
export const matchesFilter = (haystack: string, needle: string) =>
  needle === "" || haystack.toLowerCase().includes(needle.toLowerCase());
