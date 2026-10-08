/** One toggle in a SegGroup. `tone` overrides the default muted-then-accent
 *  colouring, for toggles that carry their own meaning in colour. */
import type { ReactNode } from "react";
import { SEG_BASE, SEG_TONE } from "./styles";

type Props = {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: string;
  title?: string;
  className?: string;
  ariaLabel?: string;
};

export function SegButton({ pressed, onClick, children, tone, title, className = "", ariaLabel }: Props) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      onClick={onClick}
      title={title}
      className={SEG_BASE + " " + (tone ?? SEG_TONE) + " " + className}
    >
      {children}
    </button>
  );
}
