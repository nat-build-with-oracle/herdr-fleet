/**
 * fleet_watch -- "tell me when that agent is done".
 *
 * A finish is herdr's agent status leaving "working". The first version read
 * that off the 5 s scan and missed a 4 s job entirely: the scan never saw it
 * working. herdr pushes the change instead -- events.subscribe with
 * pane.agent_status_changed -- so each watched pane holds one open
 * subscription (the one socket call that stays open), and a finish fires
 * however short the job. The subscription closes when nobody watches that
 * pane any more.
 */
import { connect, type Socket } from "node:net";

type Watcher = { pane?: string; once: boolean; since: number };
type Finish = (watched: string, status: string, watcher: string | undefined) => void;

const SOCK = process.env.HERDR_SOCKET_PATH ?? `${process.env.HOME}/.config/herdr/herdr.sock`;

const watches = new Map<string, Watcher[]>(); // watched pane -> watchers
const subs = new Map<string, Socket>(); // watched pane -> open subscription
let onFinish: Finish = () => {};

function subscribe(pane: string) {
  if (subs.has(pane)) return;
  const s = connect(SOCK);
  subs.set(pane, s);
  let buf = "";
  let working = false;
  s.on("connect", () =>
    s.write(
      JSON.stringify({
        id: `watch-${pane}`,
        method: "events.subscribe",
        params: { subscriptions: [{ type: "pane.agent_status_changed", pane_id: pane }] },
      }) + "\n",
    ),
  );
  s.on("data", (b) => {
    buf += b.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      // shape: {"event":"pane.agent_status_changed","data":{"agent_status":...}}
      const status = m?.data?.agent_status;
      if (!status) continue;
      if (status === "working") {
        working = true;
        continue;
      }
      if (!working) continue; // idle -> idle is not a finish
      working = false;
      for (const w of [...(watches.get(pane) ?? [])]) {
        onFinish(pane, status, w.pane);
        if (w.once) watch.remove(pane, w.pane);
      }
    }
  });
  // herdr restarting drops the socket; resubscribe while still watched
  s.on("close", () => {
    subs.delete(pane);
    if (watches.has(pane)) setTimeout(() => subscribe(pane), 2000);
  });
  s.on("error", () => {});
}

export const watch = {
  /** The server supplies what a finish does (notes, delivery). */
  onFinish(fn: Finish) {
    onFinish = fn;
  },

  add(target: string, watcher: string | undefined, once = true) {
    const rest = (watches.get(target) ?? []).filter((w) => w.pane !== watcher);
    rest.push({ pane: watcher, once, since: Date.now() });
    watches.set(target, rest);
    subscribe(target);
  },

  remove(target: string, watcher: string | undefined) {
    const rest = (watches.get(target) ?? []).filter((w) => w.pane !== watcher);
    if (rest.length) return void watches.set(target, rest);
    watches.delete(target);
    subs.get(target)?.destroy();
    subs.delete(target);
  },

  list(): { target: string; watchers: (string | undefined)[] }[] {
    return [...watches.entries()].map(([target, ws]) => ({ target, watchers: ws.map((w) => w.pane) }));
  },
};
