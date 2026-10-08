/** The sticky header strip. Each page fills it; the shell is shared so the
 *  two pages line up exactly when you move between them. */
import type { ReactNode } from "react";

export function TopBar({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-3 flex flex-wrap items-baseline gap-4 border-b border-rule bg-paper px-4 py-3 sm:px-8">
      {children}
    </header>
  );
}
