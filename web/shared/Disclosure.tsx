/** A collapsible group: a header button with a caret, a name, and a trailing
 *  slot, then its children when open. The sidebar's repo disclosure, used by
 *  the console's repo groups and compare's alike.
 *
 *  `lead` sits before the name (a state mark, say); `tail` is pushed to the
 *  far end (counts). Both stay visible when collapsed, which is the point --
 *  a shut group should still say whether anything inside it matters. */
import type { ReactNode } from "react";
import { CARET } from "./glyphs";

type Props = {
  name: string;
  open: boolean;
  onToggle: () => void;
  lead?: ReactNode;
  tail?: ReactNode;
  children: ReactNode;
};

const HEADER =
  "flex w-full items-baseline gap-2 text-start cursor-pointer " +
  "mt-6 mb-1 pe-2 py-1 " +
  "border-0 border-b border-rule bg-transparent " +
  "font-mono text-base font-medium tracking-[-0.01em] text-ink " +
  "transition-colors duration-150 ease-out hover:text-accent hover:border-accent " +
  "focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-[3px]";

export function Disclosure({ name, open, onToggle, lead, tail, children }: Props) {
  return (
    <section className="[&:first-of-type>button]:mt-0">
      <button type="button" className={HEADER} aria-expanded={open} onClick={onToggle}>
        <span className="w-[1.5ch] shrink-0 text-muted" aria-hidden="true">
          {open ? CARET.open : CARET.shut}
        </span>
        {lead}
        <span className="truncate">{name}</span>
        {tail && (
          <span className="ms-auto flex shrink-0 gap-2 text-xs font-normal tabular-nums">
            {tail}
          </span>
        )}
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}
