/** Which verdicts to show. Differences are on by default; "same" is off,
 *  because on a real fleet it is most of the list and none of the news. */
import { SegButton } from "../shared/SegButton";
import { SegGroup } from "../shared/SegGroup";
import { GUT, VERDICT_LABEL, VERDICT_TEXT, VERDICTS } from "./verdicts";
import type { Verdict } from "./types";

type Props = { shown: Set<Verdict>; onToggle: (v: Verdict) => void };

export function VerdictFilter({ shown, onToggle }: Props) {
  return (
    <SegGroup label="Show verdicts">
      {VERDICTS.map((v) => (
        <SegButton
          key={v}
          pressed={shown.has(v)}
          onClick={() => onToggle(v)}
          // off is muted rather than a faded verdict colour -- fading it would
          // drop the contrast below the floor, and the glyph still names it
          tone={shown.has(v) ? VERDICT_TEXT[v] : "text-muted"}
        >
          {GUT[v]} {VERDICT_LABEL[v]}
        </SegButton>
      ))}
    </SegGroup>
  );
}
