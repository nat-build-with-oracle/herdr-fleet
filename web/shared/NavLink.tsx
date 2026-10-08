/** A link to the other page. Muted, so it never competes with the wordmark. */
import type { ReactNode } from "react";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="font-mono text-base font-normal text-muted no-underline transition-colors duration-150 ease-out hover:text-accent focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-[3px]"
    >
      {children}
    </a>
  );
}
