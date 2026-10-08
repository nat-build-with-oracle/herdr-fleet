/** The list view: a column head, then one collapsible group per repo. */
import { RepoGroup } from "./RepoGroup";
import { groupByRepo } from "./groupRows";
import type { Row } from "./types";

type Props = {
  rows: Row[];
  machine: string;
  collapsed: Set<string>;
  onToggleRepo: (repo: string) => void;
  now: number;
};

/* The head only makes sense while the two columns are side by side; below the
   breakpoint the rows stack and each half labels itself with its own states. */
const HEAD =
  "sticky top-0 z-2 mb-1 hidden items-center gap-2 border-b border-rule bg-paper " +
  "px-2 py-1 font-mono text-xs text-muted " +
  "wide:grid wide:grid-cols-[minmax(0,1fr)_3.5ch_minmax(0,1fr)]";

export function TreeList({ rows, machine, collapsed, onToggleRepo, now }: Props) {
  const groups = groupByRepo(rows);
  return (
    <>
      <div className={HEAD}>
        <span>local</span>
        <span />
        <span>{machine}</span>
      </div>
      {groups.map((g) => (
        <RepoGroup
          key={g.repo}
          group={g}
          open={!collapsed.has(g.repo)}
          onToggle={() => onToggleRepo(g.repo)}
          now={now}
        />
      ))}
    </>
  );
}
