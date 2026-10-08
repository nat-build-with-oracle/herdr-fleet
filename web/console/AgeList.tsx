/** "What was I just doing": every worktree with a transcript, newest first,
 *  flat -- each row names its repo, since there is no group header to. */
import { Lede } from "../shared/Lede";
import type { Node } from "../shared/types";
import type { Verb } from "./types";
import { WorktreeRow } from "./WorktreeRow";

type Props = {
  rows: Node[];
  tails: Set<string>;
  onToggleTail: (path: string) => void;
  empty: string;
  now: number;
  isBusy: (verb: Verb, node: Node) => boolean;
  onRun: (verb: Verb, node: Node) => void;
};

export function AgeList({ rows, tails, onToggleTail, empty, now, isBusy, onRun }: Props) {
  return (
    <>
      <div className="mb-1 flex items-baseline gap-2 border-b border-rule py-1 font-mono text-base font-medium tracking-[-0.01em]">
        most recent first
        <span className="text-xs font-normal tabular-nums text-muted">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <Lede>{empty}</Lede>
      ) : (
        rows.map((n) => (
          <WorktreeRow
            key={n.path}
            node={n}
            last={null}
            withRepo
            tailOpen={tails.has(n.path)}
            onToggleTail={() => onToggleTail(n.path)}
            now={now}
            isBusy={isBusy}
            onRun={onRun}
          />
        ))
      )}
    </>
  );
}
