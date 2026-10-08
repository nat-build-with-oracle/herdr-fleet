/** The second strip, under the header: the page's controls, laid flat. */
import type { ReactNode } from "react";

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-rule-2 px-4 py-2 font-mono text-xs sm:px-8">
      {children}
    </div>
  );
}
