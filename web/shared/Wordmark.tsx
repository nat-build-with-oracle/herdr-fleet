/** The page title in Neo blue. */
import type { ReactNode } from "react";

export function Wordmark({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-0 font-mono text-base font-medium tracking-[-0.01em] text-accent">
      {children}
    </h1>
  );
}
