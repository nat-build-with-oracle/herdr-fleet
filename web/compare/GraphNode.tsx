/** One box in the graph view. The ref callback hands the element to the pair
 *  registry so useEdges can measure it after layout. */
import { StateMark } from "../shared/StateMark";
import { STATE_EDGE, STATE_TEXT } from "../shared/styles";
import type { SideInfo } from "./types";

type Props = {
  side?: SideInfo | null;
  label: string;
  hot: boolean;
  onHot: (on: boolean) => void;
  register: (el: HTMLElement | null) => void;
};

const BOX =
  "flex min-w-0 items-baseline gap-2 rounded border py-1 pe-2 ps-3 font-mono text-xs " +
  "transition-colors duration-150 ease-out";

export function GraphNode({ side, label, hot, onHot, register }: Props) {
  if (!side) {
    // an unmatched pair has no node on this side; say so rather than leave a hole
    return (
      <div className={BOX + " border-dashed border-rule-2 bg-transparent text-rule"} ref={register}>
        {"— absent —"}
      </div>
    );
  }
  return (
    <div
      ref={register}
      className={BOX + " bg-paper-2 " + STATE_EDGE[side.state] + (hot ? " border-accent" : " border-rule")}
      onMouseEnter={() => onHot(true)}
      onMouseLeave={() => onHot(false)}
    >
      <StateMark state={side.state} />
      <span className="min-w-0 flex-1 truncate" title={side.path}>
        {label}
      </span>
      <span className={"shrink-0 " + STATE_TEXT[side.state]}>{side.state}</span>
    </div>
  );
}
