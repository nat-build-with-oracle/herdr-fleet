/** Every network call the console makes.
 *
 *  Reads are open. /api/act is not: it needs the token the server bakes into
 *  this page's <meta name="fleet-token">. If that tag still holds the literal
 *  placeholder, the page was opened some way other than from the server, and
 *  every action would 403 -- say that, instead of a bare status code. */
import type { Node } from "../shared/types";
import type { FleetEvent, Verb } from "./types";

const TOKEN =
  document.querySelector<HTMLMetaElement>('meta[name="fleet-token"]')?.content ?? "";
const HAS_TOKEN = TOKEN !== "" && TOKEN !== "__FLEET_TOKEN__";

/** Where the live hub is, or null when this page holds no token. */
export function hubUrl(): string | null {
  if (!HAS_TOKEN) return null;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?role=web&token=${encodeURIComponent(TOKEN)}`;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.error) throw new Error(body?.error ?? `${url} returned ${r.status}`);
  return body as T;
}

export function fetchTree(fresh: boolean) {
  return getJson<{ nodes: Node[]; at: number }>("/api/tree" + (fresh ? "?fresh=1" : ""));
}

export async function fetchTail(pane: string): Promise<string> {
  const out = await getJson<{ text: string }>("/api/tail?pane=" + encodeURIComponent(pane));
  return out.text;
}

export function fetchEvents(since: number) {
  return getJson<{ events: FleetEvent[]; at: number }>("/api/events?since=" + since);
}

export async function act(verb: Verb, path: string): Promise<void> {
  if (!HAS_TOKEN) {
    throw new Error("this page has no action token — open it from the fleet server");
  }
  const r = await fetch("/api/act", {
    method: "POST",
    headers: { "content-type": "application/json", "x-fleet-token": TOKEN },
    body: JSON.stringify({ verb, path }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.error) throw new Error(body?.error ?? `act returned ${r.status}`);
}

/** Type a prompt into the Claude in a pane (fleet_send). Returns the server's
 *  own account of where it went. */
export async function send(pane: string, text: string, submit = true): Promise<string> {
  if (!HAS_TOKEN) throw new Error("this page has no action token — open it from the fleet server");
  const r = await fetch("/api/send", {
    method: "POST",
    headers: { "content-type": "application/json", "x-fleet-token": TOKEN },
    body: JSON.stringify({ target: pane, text, submit }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.error) throw new Error(body?.error ?? `send returned ${r.status}`);
  return body.note;
}
