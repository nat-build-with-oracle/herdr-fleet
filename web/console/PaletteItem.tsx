/** One result in the command palette. The verb hint shows only on the active
 *  row -- on every row at once it is noise, not guidance. */
import { StateMark } from "../shared/StateMark";
import { formatAge } from "../shared/time";
import type { Node } from "../shared/types";
import { paletteHint } from "./worktrees";

type Props = {
  node: Node;
  active: boolean;
  now: number;
  onPick: () => void;
  onHover: () => void;
};

export function PaletteItem({ node, active, now, onPick, onHover }: Props) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      onMouseMove={onHover}
      ref={(el) => {
        if (active) el?.scrollIntoView({ block: "nearest" });
      }}
      className={
        "grid w-full cursor-pointer grid-cols-[1ch_minmax(0,1fr)_auto_auto] items-center gap-2 " +
        "border-0 bg-transparent px-4 py-1 text-start font-mono text-[0.8125rem] text-ink " +
        "aria-selected:bg-paper-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      }
    >
      <StateMark state={node.state} />
      <span className="truncate">
        {node.repo} / {node.label}
      </span>
      <span className="text-xs tabular-nums text-muted">{formatAge(node.sessionAt, now)}</span>
      <span className={"text-xs text-accent " + (active ? "" : "invisible")}>{paletteHint(node)}</span>
    </button>
  );
}
