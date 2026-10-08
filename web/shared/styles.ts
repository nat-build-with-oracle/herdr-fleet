/**
 * Class strings more than one component needs, on either page.
 *
 * Tailwind generates utilities by scanning source text, so a class can never
 * be assembled at runtime -- `text-${state}` produces nothing. Every variant
 * is spelled out below, which is what Tailwind needs and what keeps the
 * vocabulary greppable.
 */
import type { State } from "./types";

export const STATE_TEXT: Record<State, string> = {
  running: "text-running",
  open: "text-open",
  resumable: "text-resumable",
  cold: "text-cold",
};

/** The state bar down a box's leading edge. An inset shadow rather than a
 *  border-inline-start colour: the box sets border-color on all four sides
 *  for hover, and that shorthand beats the longhand whatever the class order
 *  -- Tailwind sorts utilities itself. A shadow cannot collide. */
export const STATE_EDGE: Record<State, string> = {
  running: "shadow-[inset_2px_0_0_var(--color-running)]",
  open: "shadow-[inset_2px_0_0_var(--color-open)]",
  resumable: "shadow-[inset_2px_0_0_var(--color-resumable)]",
  cold: "shadow-[inset_2px_0_0_var(--color-cold)]",
};

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-[3px] ";

/** 44px targets on two independent signals: the width query misses a touch
 *  tablet, the pointer query misses a narrow desktop window. */
const TOUCH = "max-sm:min-h-11 pointer-coarse:min-h-11 ";

/** A plain text button: monospace, underlined by a hairline, accent on hover. */
export const BTN =
  "font-mono text-xs text-ink-2 border-0 border-b border-rule bg-transparent " +
  "py-1 cursor-pointer whitespace-nowrap transition-colors duration-150 ease-out " +
  "hover:text-accent hover:border-accent " +
  FOCUS +
  TOUCH +
  "aria-busy:text-muted aria-busy:cursor-progress";

/** A segmented toggle without a text colour -- callers set it, because the
 *  compare verdict filters carry their own and would fight the accent. */
export const SEG_BASE =
  "font-mono text-xs cursor-pointer whitespace-nowrap border border-transparent rounded " +
  "px-2 py-1 bg-transparent transition-colors duration-150 ease-out " +
  TOUCH +
  FOCUS +
  "aria-pressed:border-rule aria-pressed:bg-paper-2";

/** The default toggle colour: muted until pressed, accent when it is. */
export const SEG_TONE = "text-muted hover:text-accent aria-pressed:text-accent";

/** A boxed action button. Eight states: default, hover, focus-visible,
 *  active, disabled, busy -- and danger's own hover. */
export const ACT =
  "font-mono text-xs text-ink-2 bg-paper-2 border border-rule rounded px-2 py-1 " +
  "cursor-pointer whitespace-nowrap transition-colors duration-150 ease-out " +
  "enabled:hover:text-accent enabled:hover:border-accent enabled:active:bg-paper-3 " +
  FOCUS +
  TOUCH +
  "disabled:text-rule disabled:border-rule-2 disabled:cursor-not-allowed " +
  "aria-busy:text-muted aria-busy:cursor-progress";

export const ACT_DANGER = "enabled:hover:text-danger enabled:hover:border-danger";

export const INPUT =
  "font-mono text-xs text-ink bg-paper-2 border border-rule rounded px-2 py-1 w-[14ch] " +
  "max-sm:w-full placeholder:text-muted " +
  "outline-2 outline-transparent outline-offset-1 focus-visible:outline-focus " +
  "focus-visible:border-accent";
