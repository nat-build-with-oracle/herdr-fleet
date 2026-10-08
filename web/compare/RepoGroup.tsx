/** A repo and its worktree pairs, collapsible. The header carries the verdict
 *  mix so a collapsed group still says whether anything in it differs. */
import { Disclosure } from "../shared/Disclosure";
import { CompareRow } from "./CompareRow";
import { tallyVerdicts } from "./groupRows";
import type { Group } from "./groupRows";
import { GUT, VERDICT_LABEL, VERDICT_TEXT } from "./verdicts";

type Props = { group: Group; open: boolean; onToggle: () => void; now: number };

export function RepoGroup({ group, open, onToggle, now }: Props) {
  const tally = tallyVerdicts(group.rows);
  return (
    <Disclosure
      name={group.repo}
      open={open}
      onToggle={onToggle}
      tail={
        <>
          <span className="text-muted">{group.rows.length}</span>
          {tally.map(([v, n]) => (
            <span key={v} className={VERDICT_TEXT[v]} title={VERDICT_LABEL[v]}>
              {GUT[v]}
              {n}
            </span>
          ))}
        </>
      }
    >
      {group.rows.map((r, i) => (
        <CompareRow key={r.repo + "\u0000" + r.label} row={r} last={i === group.rows.length - 1} now={now} />
      ))}
    </Disclosure>
  );
}
