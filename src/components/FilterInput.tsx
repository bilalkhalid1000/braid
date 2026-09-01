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
}

export function FilterInput({ value, onChange, placeholder, matches, name }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="filter">
      <input
        ref={ref}
        className="filter-input"
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
      {value && <span className="filter-count">{matches ?? 0}</span>}
    </div>
  );
}

/** Case-insensitive substring match, the behaviour people expect from a box
 *  labelled "Filter". Fuzzy matching surprises more often than it helps here,
 *  because branch names are typed from memory. */
export const matchesFilter = (haystack: string, needle: string) =>
  needle === "" || haystack.toLowerCase().includes(needle.toLowerCase());
