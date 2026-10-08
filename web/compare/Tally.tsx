/** The five verdict counts, in the top bar. */
import { GUT, VERDICT_LABEL, VERDICT_TEXT } from "./verdicts";
import type { Counts, Verdict } from "./types";

const ORDER: [Verdict, keyof Counts][] = [
  ["same", "same"],
  ["differs", "differs"],
  ["unknowable", "unknowable"],
  ["only-left", "onlyLeft"],
  ["only-right", "onlyRight"],
];

const WRAP = "me-auto flex flex-wrap gap-4 font-mono text-xs tabular-nums";

export function Tally({ counts }: { counts?: Counts }) {
  if (!counts) return <div className={WRAP} />;
  return (
    <div className={WRAP}>
      {ORDER.map(([v, key]) => (
        <span key={v} className={VERDICT_TEXT[v]}>
          {GUT[v]} {counts[key]} {VERDICT_LABEL[v]}
        </span>
      ))}
    </div>
  );
}
