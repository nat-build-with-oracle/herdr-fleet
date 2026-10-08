/** Symbols both pages draw with. The state marks are the herdr sidebar's own
 *  four, so a worktree looks identical in the TUI, the console and compare. */
import type { State } from "./types";

export const MARK: Record<State, string> = {
  running: "◐",
  open: "○",
  resumable: "↻",
  cold: "·",
};

export const STATES: State[] = ["running", "open", "resumable", "cold"];

/** Tree drawing, as the herdr sidebar draws it. */
export const TWIG = { mid: "├─", last: "└─" } as const;

export const CARET = { open: "▾", shut: "▸" } as const;
