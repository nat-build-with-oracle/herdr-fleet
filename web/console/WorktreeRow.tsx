/** One worktree: twig, state mark, name, actions, state, then age/size/branch.
 *
 *  Wide: one line, six columns. Under the index breakpoint the row reflows to
 *  three lines -- name and state, then actions, then meta -- and every field
 *  stays a real element on screen. Nothing is dropped to make it fit.
 *
 *  A running or open worktree's name is a button: it expands a live tail of
 *  its pane. Cold and resumable worktrees have no terminal, so no button. */
import { STATE_TEXT } from "../shared/styles";
import { StateMark } from "../shared/StateMark";
import { Twig } from "../shared/Twig";
import type { Node } from "../shared/types";
import { Actions } from "./Actions";
import { LiveTail } from "./LiveTail";
import { RowMeta } from "./RowMeta";
import { SendBox } from "./SendBox";
import type { Verb } from "./types";
import { canTail } from "./worktrees";

type Props = {
  node: Node;
  /** true/false draws └─/├─; null is a flat list with no tree to draw */
  last: boolean | null;
  withRepo: boolean;
  tailOpen: boolean;
  onToggleTail: () => void;
  now: number;
  isBusy: (verb: Verb, node: Node) => boolean;
  onRun: (verb: Verb, node: Node) => void;
};

const ROW =
  "grid items-center gap-x-2 gap-y-1 rounded px-2 py-1 transition-colors duration-150 ease-out " +
  "hover:bg-paper-2 focus-within:bg-paper-2 " +
  "grid-cols-[2ch_1ch_minmax(0,1fr)_auto] " +
  "[grid-template-areas:'twig_mark_label_state''._._acts_acts''._._meta_meta'] " +
  "index:grid-cols-[2ch_1ch_minmax(0,1fr)_auto_9ch_minmax(0,22ch)] " +
  "index:[grid-template-areas:'twig_mark_label_acts_state_meta']";

const LABEL = "min-w-0 truncate p-0 text-start font-mono text-[0.8125rem] text-ink [grid-area:label]";

export function WorktreeRow({ node, last, withRepo, tailOpen, onToggleTail, now, isBusy, onRun }: Props) {
  const name = withRepo ? `${node.repo} / ${node.label}` : node.label;
  const tailable = canTail(node);
  return (
    <div className={ROW}>
      <span className="[grid-area:twig]">{last !== null && <Twig last={last} />}</span>
      <span className="self-start leading-none [grid-area:mark] index:self-center">
        <StateMark state={node.state} />
      </span>
      {tailable ? (
        <button
          type="button"
          title={node.path}
          aria-expanded={tailOpen}
          onClick={onToggleTail}
          className={
            LABEL +
            " cursor-pointer border-0 bg-transparent hover:text-accent aria-expanded:text-accent " +
            "rounded focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
          }
        >
          {name}
        </button>
      ) : (
        <span className={LABEL} title={node.path}>
          {name}
        </span>
      )}
      <Actions node={node} isBusy={isBusy} onRun={onRun} />
      <span className={"text-end font-mono text-xs [grid-area:state] index:text-start " + STATE_TEXT[node.state]}>
        {node.state}
      </span>
      <RowMeta node={node} now={now} />
      {tailable && tailOpen && node.paneId && <LiveTail pane={node.paneId} />}
      {/* only a running agent can be talked to; an open space is a bare shell */}
      {tailOpen && node.state === "running" && node.paneId && <SendBox pane={node.paneId} label={node.label} />}
    </div>
  );
}
