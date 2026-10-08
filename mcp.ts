#!/usr/bin/env bun
/**
 * Fleet MCP — stdio bridge.
 *
 *   claude mcp add fleet -- bun /abs/path/tools/fleet-tui/mcp.ts
 *
 * The tools themselves live in the server (POST /mcp, see mcp-tools.ts). This
 * process only does the two things a URL cannot:
 *
 *   1. speaks stdio, for clients that have no HTTP transport;
 *   2. starts the server if nothing is listening, then waits for it.
 *
 * So every frame here is forwarded to the one process that owns the scan cache
 * and the event ring buffer. Two MCP clients, a browser, and the tray all see
 * the same fleet, and an action taken here shows up in the web UI's activity
 * feed. Killing this bridge leaves the server and its agents alone.
 *
 * If you would rather skip the bridge entirely, point a client straight at the
 * endpoint once a server is up:
 *   claude mcp add --transport http fleet http://127.0.0.1:4320/mcp \
 *     --header "x-fleet-token: $(jq -r .token tools/fleet-tui/.tmp/runtime.json)"
 *
 * NOTHING may be written to stdout except protocol frames; diagnostics go to
 * stderr or they corrupt the stream.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const HERE = import.meta.dir;
const RUNTIME_FILE = `${HERE}/.tmp/runtime.json`;
const DEFAULT_PORT = Number(process.env.FLEET_PORT ?? 4320);

const log = (...a: unknown[]) => console.error("[fleet-mcp]", ...a);

type Runtime = { port: number; token: string; pid?: number };

function readRuntime(): Runtime | null {
  try {
    if (!existsSync(RUNTIME_FILE)) return null;
    const r = JSON.parse(readFileSync(RUNTIME_FILE, "utf8"));
    if (typeof r.port === "number" && typeof r.token === "string") return r;
  } catch {
    // unreadable or half-written; treat as absent
  }
  return null;
}

async function alive(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/events`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

let starting: Promise<Runtime> | null = null;

async function ensureServer(): Promise<Runtime> {
  const existing = readRuntime();
  if (existing && (await alive(existing.port))) return existing;
  if (starting) return starting;

  // A runtime file that does not answer is usually a restart mid hand-over
  // (fleet_restart keeps the file, the replacement takes a moment to bind).
  // Spawning now would race it for the port, so give it a few seconds first.
  if (existing) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      const rt = readRuntime();
      if (rt && (await alive(rt.port))) return rt;
    }
  }

  // Someone is on the port but published no runtime file — usually a server
  // that was killed hard, or whose file was removed under it. Spawning now
  // just races a doomed process against a bound port and times out, so say
  // what is actually wrong instead.
  if (await alive(DEFAULT_PORT)) {
    throw new Error(
      `a server is listening on ${DEFAULT_PORT} but ${RUNTIME_FILE} is missing or unreadable, ` +
        `so its token is unknown. Restart it so it republishes: ` +
        `pkill -f 'server\\.ts' && just fleet-server`,
    );
  }

  starting = (async () => {
    log("no server answering; starting one");
    const child = spawn("bun", ["run", `${HERE}/server.ts`], {
      cwd: HERE,
      detached: true,
      stdio: "ignore",
      // The server is shared by every agent, so it must not inherit the herdr
      // session of whichever agent happened to start it first: after a reboot it
      // bound to another herdr session and fleet_send could not see default panes (#108).
      env: {
        ...process.env,
        FLEET_PORT: String(DEFAULT_PORT),
        HERDR_SESSION: "",
        HERDR_SOCKET_PATH:
          process.env.FLEET_HERDR_SOCKET ?? `${process.env.HOME}/.config/herdr/herdr.sock`,
      },
    });
    child.unref(); // the server outlives this bridge on purpose

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      const rt = readRuntime();
      if (rt && (await alive(rt.port))) {
        log(`server up on ${rt.port} (pid ${rt.pid})`);
        return rt;
      }
    }
    throw new Error("fleet server did not come up within 15s");
  })();

  try {
    return await starting;
  } finally {
    starting = null;
  }
}

/** The pane this bridge's agent lives in. The bridge is a child of the agent's
 *  process, so it inherits the herdr pane's environment -- which is how the
 *  server can resolve "self" to the agent that is asking. */
const CALLER_PANE = process.env.HERDR_PANE_ID;

/** Forward one JSON-RPC frame to the server's /mcp endpoint. */
async function forward(frame: any): Promise<any | null> {
  const rt = await ensureServer();
  if (CALLER_PANE && frame?.method === "tools/call" && frame.params) {
    frame.params.arguments = { caller_pane: CALLER_PANE, ...(frame.params.arguments ?? {}) };
  }
  const r = await fetch(`http://127.0.0.1:${rt.port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fleet-token": rt.token },
    body: JSON.stringify(frame),
  });
  if (r.status === 202) return null; // notification: no reply
  return r.json();
}

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/* ── layer 1: a socket to the hub ─────────────────────────────────────────
 * Announces this agent's pane, so the fleet knows who is reachable, and turns
 * {type:"channel"} messages into notifications/claude/channel. Channel servers
 * that die stay dead for the rest of the session -- seen three times with
 * fakechat -- so this never gives up: it reconnects with backoff, forever,
 * including across a server restart hand-over. */
let hubDelay = 1000;
async function connectHub() {
  if (!CALLER_PANE || stdinClosed) return;
  let rt: Runtime;
  try {
    rt = await ensureServer();
  } catch {
    return void setTimeout(connectHub, (hubDelay = Math.min(hubDelay * 2, 30000)));
  }
  const url = `ws://127.0.0.1:${rt.port}/ws?role=bridge&pane=${encodeURIComponent(CALLER_PANE)}&token=${encodeURIComponent(rt.token)}`;
  const ws = new WebSocket(url);
  ws.onopen = () => {
    hubDelay = 1000;
    log(`hub connected as ${CALLER_PANE}`);
  };
  ws.onmessage = (e) => {
    let m: any;
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (m?.type !== "channel") return;
    send({
      jsonrpc: "2.0",
      method: "notifications/claude/channel",
      params: {
        content: m.text,
        // meta is data, never instructions -- a sender cannot forge these.
        // No `source`: Claude Code sets it from the server name, and adding
        // our own printed it twice on the <channel> tag (caught by the first
        // agent to receive one).
        meta: { msg_id: m.id, ...(m.inReplyTo ? { in_reply_to: m.inReplyTo } : {}), from: m.from, ...(m.fromPane ? { from_pane: m.fromPane } : {}), ts: new Date(m.at).toISOString() },
      },
    });
  };
  ws.onclose = () => {
    if (stdinClosed) return;
    setTimeout(connectHub, hubDelay);
    hubDelay = Math.min(hubDelay * 2, 30000);
  };
  ws.onerror = () => {}; // onclose follows and reconnects
}

let buf = "";
let pending = 0;
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && pending === 0) process.exit(0);
}

process.stdin.on("data", (chunk: Buffer) => {
  buf += chunk.toString();
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let frame: any;
    try {
      frame = JSON.parse(line);
    } catch {
      log("dropped unparseable frame");
      continue;
    }
    pending++;
    forward(frame)
      .then((reply) => {
        if (reply) send(reply);
      })
      .catch((e) => {
        // the client is waiting on an id; answer rather than hang
        if (frame?.id !== undefined && frame?.id !== null) {
          send({
            jsonrpc: "2.0",
            id: frame.id,
            error: { code: -32603, message: String(e?.message ?? e) },
          });
        }
        log("forward failed", e?.message ?? e);
      })
      .finally(() => {
        pending--;
        maybeExit();
      });
  }
});

// EOF must not cancel work already in flight -- a call that triggered a server
// start can still be running when the client closes the pipe
process.stdin.on("end", () => {
  stdinClosed = true;
  maybeExit();
});

log("ready on stdio");
void connectHub();
