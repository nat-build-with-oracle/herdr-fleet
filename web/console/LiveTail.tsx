/** A running worktree's terminal, inline under its row. Mounted only while
 *  the row is expanded; unmounting it is what stops the polling. */
import { useTail } from "./useTail";

export function LiveTail({ pane }: { pane: string }) {
  const text = useTail(pane);
  return (
    <pre className="col-span-full mt-1 mb-0 max-h-48 overflow-y-auto rounded border border-rule bg-paper px-3 py-2 font-mono text-xs leading-normal break-words whitespace-pre-wrap text-ink-2">
      {text}
    </pre>
  );
}
