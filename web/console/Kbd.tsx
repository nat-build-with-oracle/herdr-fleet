/** A key cap: ⌘, K, ↵, esc. */
import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-rule bg-paper-3 px-1 py-0.5 font-mono text-[0.6875rem] leading-none text-muted">
      {children}
    </kbd>
  );
}
