import type { State } from "../shared/types";

export type { Machine, State } from "../shared/types";

/** Shapes returned by /api/compare and /api/machines. One source of truth for
 *  the whole page -- every other module imports from here rather than
 *  re-describing the server's JSON. */

export type Verdict = "same" | "differs" | "unknowable" | "only-left" | "only-right";

export type View = "list" | "graph";

/** One machine's view of one worktree. `path` is a real path locally and a
 *  `herdr:<workspace>` handle for a remote space with no worktree behind it. */
export type SideInfo = {
  state: State;
  agent?: string;
  paneId?: string;
  branch?: string;
  path: string;
  sessionBytes?: number;
  /** mtime of the transcript that would be resumed. Local rows only -- a
   *  remote's transcripts sit on its own disk, which this host cannot read. */
  sessionAt?: number;
  spaceNumber?: number;
};

export type Row = {
  repo: string;
  label: string;
  verdict: Verdict;
  left?: SideInfo | null;
  right?: SideInfo | null;
};

export type Counts = {
  same: number;
  differs: number;
  unknowable: number;
  onlyLeft: number;
  onlyRight: number;
};

export type CompareData = {
  machine: string;
  counts: Counts;
  rows: Row[];
};

