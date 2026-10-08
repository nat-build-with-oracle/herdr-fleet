/** The four state counts across the whole fleet, in the header. */
import { STATES } from "../shared/glyphs";
import { StateMark } from "../shared/StateMark";
import { STATE_TEXT } from "../shared/styles";
import type { State } from "../shared/types";

export function Legend({ counts }: { counts: Record<State, number> | null }) {
  return (
    <div className="me-auto flex flex-wrap gap-4 font-mono text-xs tabular-nums" aria-live="polite">
      {counts &&
        STATES.map((s) => (
          <span key={s} className={STATE_TEXT[s] + " inline-flex items-baseline gap-1"}>
            <StateMark state={s} />
            <b className="font-medium">{counts[s]}</b> {s}
          </span>
        ))}
    </div>
  );
}
