/** The ◐ ○ ↻ · glyph for a worktree state, in its state colour. Decorative:
 *  every place that draws one also prints the state as text. */
import { MARK } from "./glyphs";
import { STATE_TEXT } from "./styles";
import type { State } from "./types";

type Props = { state: State; className?: string };

export function StateMark({ state, className = "" }: Props) {
  return (
    <span
      className={"inline-block w-[1ch] shrink-0 font-mono " + STATE_TEXT[state] + " " + className}
      aria-hidden="true"
    >
      {MARK[state]}
    </span>
  );
}
