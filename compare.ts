/**
 * This machine against a saved herdr machine -- the one comparison every
 * surface uses: the /compare page (via /api/compare), fleet_diff, the fleet
 * CLI's `diff`, and the side-by-side TUI.
 *
 * Rows pair worktrees by repo + label and carry a verdict on their STATE, not
 * just on whether they exist. It is honest about the one asymmetry: a remote
 * cannot report "resumable" (that comes from transcripts on its own disk), so
 * local-resumable vs remote-cold is "unknowable", never a difference.
 *
 * Errors are not swallowed. An unreachable machine used to come back as an
 * empty tree -- "only here: everything" -- which hid, among other things, a
 * changed SSH host key. It throws instead, and callers show the message.
 */
import { remoteTree, type Node, type State } from "./agents.ts";

export type Verdict = "same" | "differs" | "unknowable" | "only-left" | "only-right";

export type Side = {
  state: State;
  agent?: string;
  paneId?: string;
  branch?: string;
  path: string;
  sessionBytes?: number;
  /** transcript mtime -- only ever on the local side */
  sessionAt?: number;
  spaceNumber?: number;
  linked?: boolean;
};

export type CompareRow = { repo: string; label: string; verdict: Verdict; left?: Side; right?: Side };

export type Comparison = {
  machine: string;
  counts: { same: number; differs: number; unknowable: number; onlyLeft: number; onlyRight: number };
  rows: CompareRow[];
};

const slim = (n?: Node): Side | undefined =>
  n && {
    state: n.state,
    agent: n.agent,
    paneId: n.paneId,
    branch: n.branch,
    path: n.path,
    sessionBytes: n.sessionBytes,
    sessionAt: n.sessionAt,
    spaceNumber: n.spaceNumber,
    linked: n.linked,
  };

export function verdictOf(l?: Node | Side, r?: Node | Side): Verdict {
  if (l && !r) return "only-left";
  if (!l && r) return "only-right";
  if (l!.state === r!.state) return "same";
  if (l!.state === "resumable" && r!.state === "cold") return "unknowable";
  return "differs";
}

/** Compare a local tree against a machine. Throws if the machine cannot be
 *  read -- including an ambiguous label, which remoteTree refuses to guess. */
export async function compareMachines(localNodes: Node[], machine: string): Promise<Comparison> {
  const remoteNodes = await remoteTree(machine);
  const key = (n: Node) => `${n.repo}\u0000${n.label}`;
  const leftBy = new Map<string, Node>();
  for (const n of localNodes) if (n.kind === "worktree") leftBy.set(key(n), n);
  const rightBy = new Map<string, Node>();
  for (const n of remoteNodes) rightBy.set(key(n), n);

  const rows = [...new Set([...leftBy.keys(), ...rightBy.keys()])]
    .map((k): CompareRow => {
      const l = leftBy.get(k);
      const r = rightBy.get(k);
      const [repo, label] = k.split("\u0000") as [string, string];
      return { repo, label, verdict: verdictOf(l, r), left: slim(l), right: slim(r) };
    })
    .sort((a, b) => a.repo.localeCompare(b.repo) || a.label.localeCompare(b.label));

  const tally = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
  return {
    machine,
    counts: {
      same: tally("same"),
      differs: tally("differs"),
      unknowable: tally("unknowable"),
      onlyLeft: tally("only-left"),
      onlyRight: tally("only-right"),
    },
    rows,
  };
}
