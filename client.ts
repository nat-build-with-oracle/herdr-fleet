/**
 * The TUI's data source: the server when FLEET_SERVER is set, otherwise the
 * herdr API directly.
 *
 * Direct is the default because a local scan costs one socket call plus one
 * `worktree list` per repo and needs no daemon. Point at the server when the
 * web page and the TUI should agree on one cached view, or when the TUI runs
 * somewhere that cannot reach the herdr socket itself.
 */
import { tree, type Node } from "./agents.ts";
import { callTool, type ToolDeps } from "./mcp-tools.ts";

/** The tool host for direct mode: no cache, no event feed, no server. */
const LOCAL: ToolDeps = {
  getTree: () => tree(),
  getEvents: () => [],
  invalidate: () => {},
  restart: () => {
    throw new Error("no fleet server running in direct mode");
  },
};

const SERVER = process.env.FLEET_SERVER;
const TOKEN = process.env.FLEET_TOKEN ?? "";

export const source = SERVER ? `server ${SERVER}` : "direct";

export async function loadTree(fresh = false): Promise<Node[]> {
  if (!SERVER) return tree();
  const r = await fetch(`${SERVER}/api/tree${fresh ? "?fresh=1" : ""}`);
  if (!r.ok) throw new Error(`server ${r.status}`);
  return (await r.json()).nodes;
}

export async function act(verb: string, node: Node): Promise<string> {
  if (!SERVER) {
    // no server: run the same fleet_act tool in-process, so direct mode has
    // exactly the verbs, the checks and the restart path everything else has
    return callTool("fleet_act", { verb, target: node.path, caller_pane: process.env.HERDR_PANE_ID }, LOCAL);
  }
  const r = await fetch(`${SERVER}/api/act`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fleet-token": TOKEN },
    body: JSON.stringify({ verb, path: node.path }),
  });
  const out = await r.json();
  if (!r.ok || out.error) throw new Error(out.error ?? `server ${r.status}`);
  return out.note ?? `${verb} ok`;
}
