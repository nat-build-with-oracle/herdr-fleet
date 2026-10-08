#!/usr/bin/env bun
/**
 * One backend for the TUI and the web page.
 *
 *   bun run tools/fleet-tui/server.ts            # http://127.0.0.1:4320
 *
 * This process can start and kill Claude agents, so it is deliberately not a
 * neutral read-only service:
 *   - it binds 127.0.0.1 only, never 0.0.0.0;
 *   - every mutation needs the token printed at startup, which is also baked
 *     into the page it serves. A browser on some other site can reach
 *     127.0.0.1 but cannot read that token, so it cannot drive this API.
 * Keep both of those if you move this file.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  paneTail,
  remoteTree,
  tree,
  type Node,
} from "./agents.ts";
import { machines } from "./hosts.ts";
import { compareMachines } from "./compare.ts";
import { callTool, handleRpc, type ToolDeps } from "./mcp-tools.ts";
import { restartSelf, waitForPredecessor } from "./restart.ts";
import { ensureWebBuilt } from "./webBuild.ts";
import { hub, type WsData } from "./hub.ts";
import { watch } from "./watch.ts";
import { startAutoSnapshot } from "./autosnap.ts";

// 4319 is taken on this machine by an autossh -L tunnel that respawns when
// killed, so fleet would never hold it. Override with FLEET_PORT.
const PORT = Number(process.env.FLEET_PORT ?? 4320);
const TOKEN = process.env.FLEET_TOKEN ?? randomBytes(16).toString("hex");
const HERE = import.meta.dir;
/** Vite output for both pages; see vite.config.ts and webBuild.ts. */
const DIST = `${HERE}/web/dist`;
// a replacement started by restart.ts must not race its predecessor for the port
await waitForPredecessor();
const WEB_ERROR = ensureWebBuilt(HERE);
if (WEB_ERROR) console.error(`web build failed -- pages will answer 503:\n${WEB_ERROR}`);

/** A built page, or a 503 that says how to get one. The console's page gets
 *  the action token in its <meta> tag; compare's has no placeholder, so it
 *  never holds a credential it does not need. */
async function page(name: "console" | "compare"): Promise<Response> {
  const file = Bun.file(`${DIST}/${name}/index.html`);
  if (!(await file.exists())) {
    return new Response(
      `The ${name} page is not built.\n\n` +
        (WEB_ERROR ? `The build on boot failed:\n${WEB_ERROR}\n\n` : "") +
        "  build it:  bun run web:build\n" +
        "  or develop with HMR:  bun run web:dev   (http://127.0.0.1:5173)\n",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  const html = (await file.text()).replace("__FLEET_TOKEN__", TOKEN);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

type Cache = { at: number; data: Node[] };
let cache: Cache | null = null;

type Event = { at: number; path: string; repo: string; label: string; from: string; to: string };
const EVENTS_MAX = 200;
const events: Event[] = [];
let prevByPath = new Map<string, string>();

/** Diffs consecutive scans into a feed -- what changed, not just what is. */
function recordTransitions(nodes: Node[]) {
  const nextByPath = new Map<string, string>();
  for (const n of nodes) {
    if (n.kind !== "worktree") continue;
    nextByPath.set(n.path, n.state);
    const from = prevByPath.get(n.path);
    if (from && from !== n.state) {
      const ev = { at: Date.now(), path: n.path, repo: n.repo, label: n.label, from, to: n.state };
      events.unshift(ev);
      hub.pushWeb({ type: "event", event: ev });
      if (events.length > EVENTS_MAX) events.length = EVENTS_MAX;
    }
  }
  prevByPath = nextByPath;
}

let seeded = false;

async function cachedTree(maxAgeMs = 4000): Promise<Node[]> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.data;
  const data = await tree();
  cache = { at: Date.now(), data };
  // the first scan has no baseline to diff against -- record it, don't emit
  if (seeded) recordTransitions(data);
  else {
    for (const n of data) if (n.kind === "worktree") prevByPath.set(n.path, n.state);
    seeded = true;
  }
  return data;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}


/** What the agent last said, not its chrome. Claude's screen ends with the
 *  input box (between two rules) and a status bar; the first note shipped
 *  exactly those lines. Keep what is above the input box. */
function lastWords(tail: string, keep = 8): string {
  const lines = tail.split("\n").map((l) => l.trimEnd());
  const rules = lines.map((l, i) => (/^\s*─{8,}/.test(l) ? i : -1)).filter((i) => i >= 0);
  const cut = rules.length >= 2 ? rules[rules.length - 2]! : lines.length;
  return lines
    .slice(0, cut)
    .filter((l) => l.trim() && !/^\s*[✻✽✢·*]\s+\w+(ed|ing)\b.*(for|·)/.test(l) && !/^\s*[\d,]+ tokens\s*$/.test(l))
    .slice(-keep)
    .join("\n");
}

/** Tell a watcher that the agent it watched has finished, with the tail. */
watch.onFinish(async (watched, status, watcher) => {
  const tail = await paneTail(watched, 60).catch(() => "");
  const lines = lastWords(tail);
  const label = (cache?.data ?? []).find((n) => n.paneId === watched)?.label ?? watched;
  const msg = {
    id: `w${Date.now().toString(36)}`,
    text: `[fleet_watch] ${label} (${watched}) finished -- working -> ${status}.\nLast lines:\n${lines}`,
    from: "fleet_watch",
    fromPane: watched,
    at: Date.now(),
  };
  // a reply to the note goes to the agent that finished
  hub.noteSender(msg.id, watched);
  if (!watcher) return void hub.pushWeb({ type: "watch", msg });
  hub.file(watcher, msg);
  hub.deliver(watcher, msg);
});

/* While the console is open, scan on our own so transitions are pushed the
 * moment they happen. Nobody watching, no scanning -- the herdr socket is not
 * polled for an empty room. */
setInterval(() => {
  if (hub.watched()) void cachedTree(4000).catch(() => {});
}, 5000);

/* MCP reads through the same cache and the same event buffer as the web UI, so
 * an MCP action lands in the activity feed and neither view drifts. */
const mcpDeps: ToolDeps = {
  getTree: (maxAgeMs?: number) => cachedTree(maxAgeMs),
  getEvents: () => events,
  invalidate: () => {
    cache = null;
    // the console re-reads the tree now rather than on its next 15 s poll
    hub.pushWeb({ type: "tree" });
  },
  restart: () => restartSelf(`${HERE}/server.ts`, HERE, TOKEN, PORT),
  deliver: (pane, msg) => hub.deliver(pane, msg),
  bridgePanes: () => hub.panes(),
  hub,
  watch,
};

function serveOrExplain(options: Parameters<typeof Bun.serve>[0]) {
  try {
    return Bun.serve(options);
  } catch (e: any) {
    // a silent death here looks like "the server never came up" to the MCP
    // bridge and the tray; name the real cause instead
    const busy = String(e?.message ?? e).match(/EADDRINUSE|in use|address already/i);
    console.error(
      busy
        ? `port ${PORT} is already in use — another fleet server is probably running.\n` +
            `  see it:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n` +
            `  or run on another port:  FLEET_PORT=4320 bun run server.ts`
        : `failed to bind 127.0.0.1:${PORT} — ${e?.message ?? e}`,
    );
    process.exit(1);
  }
}

const server = serveOrExplain({
  hostname: "127.0.0.1",
  websocket: {
    open: (ws: any) => hub.open(ws),
    close: (ws: any) => hub.close(ws),
    // bridges and pages only listen for now; replies arrive in layer 2
    message: () => {},
    // a quiet agent must not be dropped by an idle timeout
    idleTimeout: 0,
    sendPings: true,
  } as any,
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      if (url.searchParams.get("token") !== TOKEN) return json({ error: "bad or missing token" }, 403);
      const role = url.searchParams.get("role") === "bridge" ? "bridge" : "web";
      const pane = url.searchParams.get("pane") ?? undefined;
      const data: WsData = { role, pane, since: Date.now() };
      return srv.upgrade(req, { data }) ? undefined : json({ error: "websocket upgrade failed" }, 400);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") return page("console");

    if (url.pathname === "/api/tree") {
      const nodes = await cachedTree(url.searchParams.has("fresh") ? 0 : 4000);
      return json({ nodes, at: cache?.at ?? Date.now() });
    }


    if (url.pathname === "/compare" || url.pathname === "/compare/" || url.pathname === "/compare.html") {
      return page("compare");
    }

    // Vite's hashed output. The path is checked against the dist root so a
    // crafted "/assets/../.." cannot walk out of it.
    if (url.pathname.startsWith("/assets/")) {
      const full = resolve(DIST, "." + url.pathname);
      if (!full.startsWith(DIST + "/")) return json({ error: "not found" }, 404);
      const file = Bun.file(full);
      if (!(await file.exists())) return json({ error: "not found" }, 404);
      return new Response(file, {
        // the filename carries a content hash, so this can be cached hard
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      });
    }

    /* Same/different against a machine, state included -- see compare.ts,
     * which fleet_diff, the CLI and the TUI share. */
    if (url.pathname === "/api/compare") {
      const machineArg = url.searchParams.get("machine");
      if (!machineArg) return json({ error: "machine is required" }, 400);
      try {
        return json(await compareMachines(await cachedTree(), machineArg));
      } catch (e: any) {
        return json({ error: String(e?.message ?? e) }, 500);
      }
    }

    if (url.pathname === "/api/machines") {
      const all = (await machines()).filter((m) => m.enabled);
      return json({ machines: all.map((m) => ({ id: m.id, label: m.label, target: m.target })) });
    }

    if (url.pathname === "/api/events") {
      await cachedTree(); // events are a side effect of scanning; make sure one ran
      const since = Number(url.searchParams.get("since") ?? 0);
      return json({ events: events.filter((e) => e.at > since), at: Date.now() });
    }

    /* MCP over HTTP. One process already owns the scan cache and the event
     * ring buffer, so serving MCP here means every client — local, another
     * oracle, a box across the mesh — sees the same fleet, and an action taken
     * through MCP shows up in the web UI's activity feed. Token-gated like
     * /api/act, because tools/call can resume and kill agents. */
    if (url.pathname === "/mcp") {
      if (req.method !== "POST") {
        return json({ error: "POST JSON-RPC frames to this endpoint" }, 405);
      }
      if (req.headers.get("x-fleet-token") !== TOKEN) {
        return json({ error: "bad or missing token" }, 403);
      }
      let payload: any;
      try {
        payload = await req.json();
      } catch {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      }
      // a client may batch; a notification yields no reply and is filtered out
      const frames = Array.isArray(payload) ? payload : [payload];
      const replies = (await Promise.all(frames.map((f) => handleRpc(f, mcpDeps)))).filter(Boolean);
      if (replies.length === 0) return new Response(null, { status: 202 });
      return json(Array.isArray(payload) ? replies : replies[0]);
    }

    if (url.pathname === "/api/tail") {
      const pane = url.searchParams.get("pane");
      if (!pane) return json({ error: "missing pane" }, 400);
      try {
        const text = await paneTail(pane, 40);
        return json({ pane, text });
      } catch (e: any) {
        return json({ error: String(e?.message ?? e) }, 500);
      }
    }

    /* Hand over to a fresh copy of this server (see restart.ts). Token-gated:
     * a restart drops in-flight scans and every open event stream. */
    if (url.pathname === "/api/restart" && req.method === "POST") {
      if (req.headers.get("x-fleet-token") !== TOKEN) {
        return json({ error: "bad or missing token" }, 403);
      }
      const pid = mcpDeps.restart();
      return json({ ok: true, from: process.pid, to: pid });
    }

    /* Type a prompt into a running agent (fleet_send). Token-gated: it puts
     * words in an agent's mouth. */
    if (url.pathname === "/api/send" && req.method === "POST") {
      if (req.headers.get("x-fleet-token") !== TOKEN) {
        return json({ error: "bad or missing token" }, 403);
      }
      const { target, text, submit } = (await req.json()) as { target?: string; text?: string; submit?: boolean };
      try {
        return json({ ok: true, note: await callTool("fleet_send", { target, text, submit }, mcpDeps) });
      } catch (e: any) {
        return json({ error: String(e?.message ?? e) }, 400);
      }
    }

    if (url.pathname === "/api/act" && req.method === "POST") {
      if (req.headers.get("x-fleet-token") !== TOKEN) {
        return json({ error: "bad or missing token" }, 403);
      }
      const { verb, path } = (await req.json()) as { verb?: string; path?: string };
      // every verb goes through the fleet_act tool, so the console, the TUI,
      // the CLI and MCP clients share one verb table, one target resolver and
      // one restart path. An exact path is what the console sends.
      try {
        const note = await callTool("fleet_act", { verb, path, target: path }, mcpDeps);
        return json({ ok: true, verb, note });
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        const status = /^unknown verb/.test(msg) ? 400 : /^no worktree/.test(msg) ? 404 : 500;
        return json({ error: msg }, status);
      }
    }

    return json({ error: "not found" }, 404);
  },
});

/* Runtime handshake file: the MCP server and the tray app both need to find
 * a server they did not start, and the tray needs no token (reads are open)
 * while MCP does (it can act). Written on boot, removed on exit, so its mere
 * presence is not taken as proof of liveness -- callers still probe the port. */
const RUNTIME_DIR = `${HERE}/.tmp`;
const RUNTIME_FILE = `${RUNTIME_DIR}/runtime.json`;

function publishRuntime() {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(
    RUNTIME_FILE,
    JSON.stringify({ port: server.port, token: TOKEN, pid: process.pid, at: Date.now() }, null, 2),
  );
}
/** Remove runtime.json only if it is still ours. Two cases must leave it:
 *  a restart hand-over (the replacement overwrites it with its own pid, and
 *  deleting it in between tells the MCP bridge nothing is running, so it
 *  spawns a duplicate), and a process that lost the port race -- its exit
 *  handler would otherwise delete the winner's file. */
function unpublishRuntime() {
  if (process.env.FLEET_HANDOVER === "1") return;
  try {
    const rt = JSON.parse(readFileSync(RUNTIME_FILE, "utf8"));
    if (rt.pid === process.pid) rmSync(RUNTIME_FILE);
  } catch {
    // already gone, or unreadable; nothing of ours to clean
  }
}
publishRuntime();
startAutoSnapshot();
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    unpublishRuntime();
    process.exit(0);
  });
}
process.on("exit", unpublishRuntime);

console.log(`fleet server  http://127.0.0.1:${server.port}`);
console.log(`token         ${TOKEN}`);
console.log(`runtime       ${RUNTIME_FILE}`);
console.log(`tui           FLEET_SERVER=http://127.0.0.1:${server.port} bun run agents-tui.tsx`);
