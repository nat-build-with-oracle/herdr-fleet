/** Everything about compare's five verdicts in one place: glyph, label,
 *  text colour, stroke colour, and filter order. The state vocabulary they sit
 *  beside is shared with the console and lives in ../shared. */
import type { Verdict } from "./types";

export const GUT: Record<Verdict, string> = {
  same: "=",
  differs: "≠",
  unknowable: "?",
  "only-left": "◀",
  "only-right": "▶",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  same: "same",
  differs: "differs",
  unknowable: "unknowable",
  "only-left": "only here",
  "only-right": "only there",
};

/** Spelled out in full: Tailwind cannot see a class assembled at runtime. */
export const VERDICT_TEXT: Record<Verdict, string> = {
  same: "text-same",
  differs: "text-differs",
  unknowable: "text-unknowable",
  "only-left": "text-here",
  "only-right": "text-there",
};

/** For SVG strokes, which take a paint value rather than a class. */
export const VERDICT_STROKE: Record<Verdict, string> = {
  same: "var(--color-same)",
  differs: "var(--color-differs)",
  unknowable: "var(--color-unknowable)",
  "only-left": "var(--color-here)",
  "only-right": "var(--color-there)",
};

/** Filter order: the differences first, "same" last -- it is the boring case. */
export const VERDICTS: Verdict[] = ["differs", "only-left", "only-right", "unknowable", "same"];
