/** Measures the laid-out node boxes and returns one curve per pair.
 *
 *  The nodes stay real DOM -- they keep their text rendering, titles and hover
 *  -- so the edges can only be computed after layout. That is why this runs in
 *  a layout effect and re-runs on resize: measuring during render reads a box
 *  that does not exist yet, which is how an earlier version drew zero edges. */
import { useCallback, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import type { Verdict } from "./types";

export type PairRef = { left: HTMLElement | null; right: HTMLElement | null };
export type Edge = { key: string; d: string; verdict: Verdict; dashed: boolean };

export function useEdges(
  wrapRef: RefObject<HTMLElement | null>,
  nodes: Map<string, PairRef>,
  pairs: { key: string; verdict: Verdict }[],
) {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const box = wrap.getBoundingClientRect();
    const out: Edge[] = [];
    for (const p of pairs) {
      const pair = nodes.get(p.key);
      if (!pair?.left || !pair?.right) continue;
      const l = pair.left.getBoundingClientRect();
      const r = pair.right.getBoundingClientRect();
      const x1 = l.right - box.left;
      const y1 = l.top - box.top + l.height / 2;
      const x2 = r.left - box.left;
      const y2 = r.top - box.top + r.height / 2;
      // horizontal handles keep the curve flat where it meets a node, so it
      // reads as joining the box rather than crossing it
      const dx = Math.max(24, (x2 - x1) * 0.45);
      out.push({
        key: p.key,
        verdict: p.verdict,
        dashed: p.verdict === "only-left" || p.verdict === "only-right",
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
      });
    }
    setSize({ w: box.width, h: box.height });
    setEdges(out);
  }, [wrapRef, nodes, pairs]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(measure);
    const wrap = wrapRef.current;
    const ro = wrap ? new ResizeObserver(() => measure()) : null;
    if (wrap && ro) ro.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, wrapRef]);

  return { edges, size };
}
