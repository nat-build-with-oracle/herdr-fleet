/** Age, transcript size and branch as one unit. The branch is the flexible
 *  member: on a narrow column it ellipsizes, and the title keeps the full
 *  name readable -- 44 of 65 branch names truncate at this width. */
import { formatAge, formatBytes } from "../shared/time";
import type { Node } from "../shared/types";

const NUM = "shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-muted";

export function RowMeta({ node, now }: { node: Node; now: number }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2 [grid-area:meta]">
      <span className={NUM}>{formatAge(node.sessionAt, now)}</span>
      <span className={NUM}>{formatBytes(node.sessionBytes)}</span>
      <span className="min-w-[3ch] flex-1 truncate font-mono text-xs text-muted" title={node.branch}>
        {node.branch}
      </span>
    </span>
  );
}
