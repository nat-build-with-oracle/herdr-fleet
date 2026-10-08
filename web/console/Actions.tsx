/** The five verbs, right after the worktree's name -- acting on it is the
 *  row's primary task, so nothing stands between the name and the buttons. */
import type { Node } from "../shared/types";
import { ActButton } from "./ActButton";
import type { Verb } from "./types";
import { allowed } from "./worktrees";

const VERBS: { verb: Verb; danger?: boolean }[] = [
  { verb: "open" },
  { verb: "resume" },
  { verb: "start" },
  { verb: "restart" },
  { verb: "kill", danger: true },
  { verb: "close", danger: true },
];

type Props = {
  node: Node;
  isBusy: (verb: Verb, node: Node) => boolean;
  onRun: (verb: Verb, node: Node) => void;
};

export function Actions({ node, isBusy, onRun }: Props) {
  const ok = allowed(node);
  return (
    <span className="flex flex-wrap gap-1 [grid-area:acts]">
      {VERBS.map(({ verb, danger }) => (
        <ActButton
          key={verb}
          label={verb}
          enabled={ok[verb]}
          busy={isBusy(verb, node)}
          danger={danger}
          onRun={() => onRun(verb, node)}
        />
      ))}
    </span>
  );
}
