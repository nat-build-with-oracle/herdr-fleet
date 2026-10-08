/** The palette's trigger, beside the wordmark. On a narrow screen it shrinks
 *  to the search glyph -- a ⌘K hint means nothing without a keyboard. */
import { Kbd } from "./Kbd";

export function CmdKPill({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={
        "inline-flex cursor-pointer items-center gap-2 rounded-full border border-rule bg-paper-2 " +
        "py-1 ps-3 pe-2 font-mono text-xs text-muted max-sm:px-2 max-sm:min-h-11 pointer-coarse:min-h-11 " +
        "outline-2 outline-offset-2 outline-transparent transition-colors duration-150 ease-out " +
        "hover:border-rule-2 hover:text-ink-2 focus-visible:outline-focus active:bg-paper-3"
      }
    >
      <span aria-hidden="true">{"⌕"}</span>
      <span className="max-sm:hidden">Jump to a worktree{"…"}</span>
      <span className="flex gap-0.5 max-sm:hidden">
        <Kbd>{"⌘"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}
