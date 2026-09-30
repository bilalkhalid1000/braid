import type { RepoHealth } from "../lib/api";

/** A size in KiB, the way a person would say it. */
export function formatKib(kib: number) {
  if (kib >= 1024 * 1024) return `${(kib / (1024 * 1024)).toFixed(1)} GB`;
  if (kib >= 1024) return `${(kib / 1024).toFixed(1)} MB`;
  return `${kib} KB`;
}

/** Git's own thresholds, `gc.auto` and `gc.autoPackLimit` -- the same ones
 *  the backend gives its reasons by. */
const LOOSE_LIMIT = 6700;
const PACK_LIMIT = 50;

const ROW = "flex justify-between gap-8 py-[3px]";

/** The object store as it stands, under the clean-up question: the numbers
 *  the decision is made on, and why they are worth acting on. */
export function CleanupFacts({ health }: { health: RepoHealth }) {
  const rows: [string, string, boolean][] = [
    [
      "Loose objects",
      `${health.loose.toLocaleString()} · ${formatKib(health.looseKib)}`,
      health.loose >= LOOSE_LIMIT,
    ],
    ["Packs", `${health.packs} · ${formatKib(health.packKib)}`, health.packs >= PACK_LIMIT],
    [
      "Leftover files",
      `${health.garbage} · ${formatKib(health.garbageKib)}`,
      health.garbage > 0,
    ],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-sm border border-border-soft bg-surface-alt px-5 py-3 text-small">
        {rows.map(([label, value, flagged]) => (
          <div className={ROW} key={label}>
            <span className="text-text-dim">{label}</span>
            <span className={`font-mono ${flagged ? "text-modified" : ""}`}>{value}</span>
          </div>
        ))}
      </div>

      {health.reasons.length > 0 && (
        <ul className="m-0 flex flex-col gap-2 pl-8 text-small text-text-dim">
          {health.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
