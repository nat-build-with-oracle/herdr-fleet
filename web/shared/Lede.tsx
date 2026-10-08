/** A muted sentence in place of content: loading, empty, or filtered out. */
import type { ReactNode } from "react";

export function Lede({ children }: { children: ReactNode }) {
  return <p className="mb-6 max-w-[750px] text-[0.8125rem] text-muted">{children}</p>;
}
