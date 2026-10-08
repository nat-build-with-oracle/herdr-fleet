/** Shapes both pages read from the fleet server. Page-specific shapes live in
 *  each page's own types.ts; anything two pages would otherwise re-describe
 *  lives here. */

export type State = "running" | "open" | "resumable" | "cold";

/** One entry of /api/tree -- a repo header or a worktree under it. */
export type Node = {
  kind: "repo" | "worktree";
  repo: string;
  repoRoot: string;
  label: string;
  path: string;
  branch?: string;
  linked: boolean;
  state: State;
  status: string;
  agent?: string;
  workspaceId?: string;
  paneId?: string;
  sessionId?: string;
  /** mtime of the transcript that would be resumed, and its size in bytes */
  sessionAt?: number;
  sessionBytes?: number;
  /** position of the open herdr space in the sidebar; absent when closed */
  spaceNumber?: number;
};

/** A saved herdr machine. Labels repeat across profiles; the id is unique. */
export type Machine = { id: string; label: string; target: string };
