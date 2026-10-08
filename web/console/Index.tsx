/** The default view: every repo as a collapsible group of its worktrees. */
import { Lede } from "../shared/Lede";
import type { Node } from "../shared/types";
import { RepoGroup } from "./RepoGroup";
import type { Verb } from "./types";
import type { RepoGroup as Group } from "./worktrees";

type Props = {
  groups: Group[];
  collapsed: Set<string>;
  onToggleRepo: (repoRoot: string) => void;
  tails: Set<string>;
  onToggleTail: (path: string) => void;
  empty: string;
  now: number;
  isBusy: (verb: Verb, node: Node) => boolean;
  onRun: (verb: Verb, node: Node) => void;
};

export function Index({ groups, collapsed, onToggleRepo, empty, ...rest }: Props) {
  if (!groups.length) return <Lede>{empty}</Lede>;
  return (
    <>
      {groups.map((g) => (
        <RepoGroup
          key={g.repoRoot}
          group={g}
          open={!collapsed.has(g.repoRoot)}
          onToggle={() => onToggleRepo(g.repoRoot)}
          {...rest}
        />
      ))}
    </>
  );
}
