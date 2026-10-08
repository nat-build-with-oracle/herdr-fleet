/** ├─ or └─, the herdr sidebar's branch drawing for a child row. */
import { TWIG } from "./glyphs";

export function Twig({ last }: { last: boolean }) {
  return (
    <span className="shrink-0 font-mono text-rule" aria-hidden="true">
      {last ? TWIG.last : TWIG.mid}
    </span>
  );
}
