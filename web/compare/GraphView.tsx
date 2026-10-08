/** The same pairs as the list, drawn as a bipartite graph: a node per
 *  worktree on its own side, an edge per match. Unmatched rows get a dashed
 *  stub to an "absent" ghost rather than a line to nowhere.
 *
 *  Below the breakpoint the columns stack and the edges are dropped -- a
 *  curve between two boxes in one column would be noise, not information. */
import { useMemo, useRef, useState } from "react";
import { GraphNode } from "./GraphNode";
import { VERDICT_STROKE } from "./verdicts";
import type { PairRef } from "./useEdges";
import { useEdges } from "./useEdges";
import type { Row } from "./types";

type Props = { rows: Row[]; machine: string };

const COLS =
  "relative z-1 grid items-start gap-x-2 gap-y-1 grid-cols-[minmax(0,1fr)] " +
  "wide:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]";
const COLHEAD =
  "mb-2 border-b border-rule pb-1 font-mono text-xs text-muted";

export function GraphView({ rows, machine }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nodes = useRef(new Map<string, PairRef>()).current;
  const [hot, setHot] = useState<string | null>(null);

  const pairs = useMemo(
    () => rows.map((r) => ({ key: r.repo + "\u0000" + r.label, verdict: r.verdict })),
    [rows],
  );
  const { edges, size } = useEdges(wrapRef, nodes, pairs);

  const put = (key: string, side: "left" | "right") => (el: HTMLElement | null) => {
    const cur = nodes.get(key) ?? { left: null, right: null };
    cur[side] = el;
    if (el) nodes.set(key, cur);
    else if (!cur.left && !cur.right) nodes.delete(key);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <svg
        className="pointer-events-none absolute inset-0 z-0 hidden wide:block"
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        aria-hidden="true"
      >
        {edges.map((e) => (
          <path
            key={e.key}
            d={e.d}
            fill="none"
            stroke={VERDICT_STROKE[e.verdict]}
            strokeWidth={e.verdict === "same" ? 1 : 1.5}
            opacity={e.verdict === "same" ? 0.35 : 0.75}
            strokeDasharray={e.dashed ? "2 4" : undefined}
          />
        ))}
      </svg>
      <div className={COLS}>
        <div className={COLHEAD}>local</div>
        <div className={COLHEAD + " hidden text-center wide:block"}>match</div>
        <div className={COLHEAD}>{machine}</div>
        {rows.map((r) => {
          const key = r.repo + "\u0000" + r.label;
          return (
            <PairCells
              key={key}
              row={r}
              pairKey={key}
              hot={hot === key}
              onHot={(on) => setHot(on ? key : null)}
              register={put}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Three grid cells for one pair. Split out only so the grid children stay
 *  flat -- a wrapper element here would break the three-column layout. */
function PairCells({
  row,
  pairKey,
  hot,
  onHot,
  register,
}: {
  row: Row;
  pairKey: string;
  hot: boolean;
  onHot: (on: boolean) => void;
  register: (key: string, side: "left" | "right") => (el: HTMLElement | null) => void;
}) {
  return (
    <>
      <GraphNode
        side={row.left}
        label={row.label}
        hot={hot}
        onHot={onHot}
        register={register(pairKey, "left")}
      />
      <div className="hidden min-h-px wide:block" />
      <GraphNode
        side={row.right}
        label={row.label}
        hot={hot}
        onHot={onHot}
        register={register(pairKey, "right")}
      />
    </>
  );
}
