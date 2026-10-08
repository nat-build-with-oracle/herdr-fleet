/** A repo and its worktrees, collapsible. The header's mark is the repo's
 *  rolled-up state; its count is every worktree in the repo, filtered or not,
 *  so hiding cold rows never makes a repo look smaller than it is. */
import { Disclosure } from "../shared/Disclosure";
import { StateMark } from "../shared/StateMark";
import type { Node } from "../shared/types";
import type { Verb } from "./types";
import { WorktreeRow } from "./WorktreeRow";
import type { RepoGroup as Group } from "./worktrees";

type Props = {
  group: Group;
  open: boolean;
  onToggle: () => void;
  tails: Set<string>;
  onToggleTail: (path: string) => void;
  now: number;
  isBusy: (verb: Verb, node: Node) => boolean;
  onRun: (verb: Verb, node: Node) => void;
};

export function RepoGroup({ group, open, onToggle, tails, onToggleTail, now, isBusy, onRun }: Props) {
  return (
    <Disclosure
      name={group.repo}
      open={open}
      onToggle={onToggle}
      lead={<StateMark state={group.state} />}
      tail={<span className="text-muted">{group.total}</span>}
    >
      {group.rows.map((n, i) => (
        <WorktreeRow
          key={n.path}
          node={n}
          last={i === group.rows.length - 1}
          withRepo={false}
          tailOpen={tails.has(n.path)}
          onToggleTail={() => onToggleTail(n.path)}
          now={now}
          isBusy={isBusy}
          onRun={onRun}
        />
      ))}
    </Disclosure>
  );
}
