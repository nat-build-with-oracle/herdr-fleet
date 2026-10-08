/**
 * The WebSocket hub -- fleet's layer 1, this machine only.
 *
 * Two kinds of peer connect to one /ws endpoint:
 *
 *   web     the console. Gets every state transition pushed the moment the
 *           server's scan sees it, and a "tree" nudge after any action, instead
 *           of polling /api/events every 3 s.
 *   bridge  an agent's stdio MCP bridge (mcp.ts), announcing its herdr pane.
 *           The hub keeps pane -> socket, which is what makes an agent
 *           reachable by channel, and knows which agents have fleet at all.
 *
 * Auth is the same token /api/act uses, passed as ?token= because a browser
 * cannot set headers on a WebSocket. The console page already holds it; a
 * bridge reads it from runtime.json. A page on another origin can open a
 * socket to 127.0.0.1 but cannot read the token, so it cannot join.
 */
import type { ServerWebSocket } from "bun";

export type Role = "web" | "bridge";
export type WsData = { role: Role; pane?: string; since: number };

/** A message for an agent, as it will arrive in its channel. */
export type ChannelMsg = {
  id: string;
  text: string;
  from: string;
  fromPane?: string;
  at: number;
  /** set on a reply: the msg_id it answers */
  inReplyTo?: string;
};

/** Who sent each message, so a reply can find its way back; and each pane's
 *  inbox, so an agent without a channel can still read what came for it. */
const senders = new Map<string, { fromPane?: string }>();
const inboxes = new Map<string, ChannelMsg[]>();
const INBOX_MAX = 100;
const SENDERS_MAX = 1000;

const webs = new Set<ServerWebSocket<WsData>>();
const bridges = new Map<string, ServerWebSocket<WsData>>();

export const hub = {
  open(ws: ServerWebSocket<WsData>) {
    if (ws.data.role === "web") webs.add(ws);
    else if (ws.data.pane) {
      // a restarted agent reconnects from the same pane; the newest socket wins
      bridges.get(ws.data.pane)?.close(4000, "replaced by a newer bridge in the same pane");
      bridges.set(ws.data.pane, ws);
    }
    this.pushWeb({ type: "presence", panes: this.panes() });
  },

  close(ws: ServerWebSocket<WsData>) {
    webs.delete(ws);
    if (ws.data.pane && bridges.get(ws.data.pane) === ws) bridges.delete(ws.data.pane);
    this.pushWeb({ type: "presence", panes: this.panes() });
  },

  /** Panes whose agent has a live fleet bridge right now. */
  panes(): string[] {
    return [...bridges.keys()].sort();
  },

  hasBridge(pane: string): boolean {
    return bridges.has(pane);
  },

  /** Is anyone listening? The server only scans on its own when so. */
  watched(): boolean {
    return webs.size > 0;
  },

  pushWeb(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const ws of webs) ws.send(data);
  },

  /** Remember who sent a message, for fleet_reply. Bounded; oldest go first. */
  noteSender(id: string, fromPane?: string) {
    senders.set(id, { fromPane });
    if (senders.size > SENDERS_MAX) senders.delete(senders.keys().next().value!);
  },

  senderOf(id: string): { fromPane?: string } | undefined {
    return senders.get(id);
  },

  /** Keep a message in a pane's inbox, newest first. */
  file(pane: string, msg: ChannelMsg) {
    const box = inboxes.get(pane) ?? [];
    box.unshift(msg);
    if (box.length > INBOX_MAX) box.length = INBOX_MAX;
    inboxes.set(pane, box);
  },

  inbox(pane: string, since = 0): ChannelMsg[] {
    return (inboxes.get(pane) ?? []).filter((m) => m.at > since);
  },

  /** Hand a message to the bridge in `pane`. False when no bridge is there. */
  deliver(pane: string, msg: ChannelMsg): boolean {
    const ws = bridges.get(pane);
    if (!ws) return false;
    ws.send(JSON.stringify({ type: "channel", ...msg }));
    return true;
  },
};
