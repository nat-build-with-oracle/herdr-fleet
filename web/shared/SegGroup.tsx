/** A labelled row of toggles. The label is for assistive tech; sighted users
 *  read the buttons themselves. */
import type { ReactNode } from "react";

export function SegGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {children}
    </div>
  );
}
