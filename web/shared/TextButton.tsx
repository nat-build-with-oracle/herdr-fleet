/** An unboxed text action -- "rescan →", "collapse all". */
import type { ReactNode } from "react";
import { BTN } from "./styles";

type Props = { onClick: () => void; busy?: boolean; children: ReactNode; title?: string };

export function TextButton({ onClick, busy, children, title }: Props) {
  return (
    <button type="button" className={BTN} onClick={onClick} aria-busy={busy || undefined} title={title}>
      {children}
    </button>
  );
}
