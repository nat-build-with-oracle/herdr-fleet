/** One machine's half of a row, drawn the way the herdr sidebar draws a child:
 *  twig, state mark, name, then age and state at the far end.
 *
 *  Both halves use this same component, so the two columns share one shape --
 *  mirroring the right one put the labels on opposite alignments and the pair
 *  stopped reading as a single row. */
import { StateMark } from "../shared/StateMark";
import { STATE_TEXT } from "../shared/styles";
import { formatAge } from "../shared/time";
import { Twig } from "../shared/Twig";
import type { SideInfo } from "./types";

type Props = { side?: SideInfo | null; label: string; last: boolean; now: number };

const BOX = "flex items-baseline gap-2 min-w-0";

export function Side({ side, label, last, now }: Props) {
  if (!side) {
    return (
      <span className={BOX + " text-rule"}>
        <Twig last={last} />
        <span className="w-[1ch] shrink-0" aria-hidden="true" />
        <span className="font-mono text-[0.8125rem]">{"—"}</span>
      </span>
    );
  }
  // the branch is worth showing only when it is not just the worktree name again
  const branch = side.branch && side.branch !== label ? side.branch : null;
  // null on every remote row -- that side has no transcript this host can read
  const age = formatAge(side.sessionAt, now);
  return (
    <span className={BOX}>
      <Twig last={last} />
      <StateMark state={side.state} />
      <span className="min-w-0 shrink truncate font-mono text-[0.8125rem]" title={side.path}>
        {label}
      </span>
      {branch && <span className="shrink-0 truncate font-mono text-xs text-muted">{branch}</span>}
      <span className="leader" aria-hidden="true" />
      {age && (
        <span className="shrink-0 font-mono text-xs text-muted tabular-nums" title="transcript age">
          {age}
        </span>
      )}
      <span className={"shrink-0 font-mono text-xs " + STATE_TEXT[side.state]}>{side.state}</span>
    </span>
  );
}
