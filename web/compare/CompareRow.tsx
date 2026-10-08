/** One worktree as both machines see it, with the verdict in the gutter.
 *
 *  Desktop: three columns, left | verdict | right. Under the wide breakpoint
 *  the halves stack under one shared gutter cell -- nothing is hidden. */
import { Side } from "./Side";
import { GUT, VERDICT_LABEL, VERDICT_TEXT } from "./verdicts";
import type { Row } from "./types";

type Props = { row: Row; last: boolean; now: number };

const ROW =
  "row grid items-center gap-2 rounded px-2 py-1 transition-colors duration-150 ease-out " +
  "hover:bg-paper-2 " +
  "grid-cols-[3.5ch_minmax(0,1fr)] [grid-template-areas:'gut_left''gut_right'] gap-y-0 " +
  "wide:grid-cols-[minmax(0,1fr)_3.5ch_minmax(0,1fr)] wide:[grid-template-areas:'left_gut_right'] wide:gap-y-2";

export function CompareRow({ row, last, now }: Props) {
  return (
    <div className={ROW}>
      <span className="[grid-area:left]">
        <Side side={row.left} label={row.label} last={last} now={now} />
      </span>
      <span
        className={
          "self-start text-center font-mono text-xs [grid-area:gut] wide:self-center " +
          VERDICT_TEXT[row.verdict]
        }
        title={VERDICT_LABEL[row.verdict]}
      >
        {GUT[row.verdict]}
      </span>
      <span className="ps-4 [grid-area:right] wide:ps-0">
        <Side side={row.right} label={row.label} last={last} now={now} />
      </span>
    </div>
  );
}
