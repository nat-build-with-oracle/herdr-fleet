/**
 * Snapshot on change, not on a clock.
 *
 * One fleet-wide herdr subscription to the structural events -- an agent
 * detected, a pane exited/closed/created, a workspace created/closed. Not
 * pane.agent_status_changed: working/idle flips are deliberately not in the
 * snapshot. Events come in bursts (a restart is exit then detect), so a
 * debounce waits for the fleet to settle, then takes ONE snapshot, which
 * commits only if a row of fleet.tsv / resumable.tsv actually changed.
 *
 * On/off is a file (.tmp/autosnapshot), so it survives server restarts.
 */
import { connect, type Socket } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { commitSnapshot, takeSnapshot } from "./snapshot.ts";

const SOCK = process.env.HERDR_SOCKET_PATH ?? `${process.env.HOME}/.config/herdr/herdr.sock`;
const FLAG = `${import.meta.dir}/.tmp/autosnapshot`;
const SETTLE_MS = 15_000;
const TYPES = ["pane.agent_detected", "pane.exited", "pane.closed", "pane.created", "workspace.created", "workspace.closed"];

let sock: Socket | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let last: { at: number; result: string } | null = null;

export function autoOn(): boolean {
  return existsSync(FLAG) && readFileSync(FLAG, "utf8").trim() === "on";
}

export function autoStatus(): string {
  return `auto-snapshot ${autoOn() ? "ON" : "off"}` + (last ? ` · last: ${new Date(last.at).toISOString().slice(11, 19)} ${last.result}` : "");
}

async function snapNow() {
  timer = null;
  try {
    const { rows, resumable, unchanged } = await takeSnapshot();
    last = { at: Date.now(), result: unchanged ? "no change" : commitSnapshot(rows, resumable) };
  } catch (e: any) {
    last = { at: Date.now(), result: `failed: ${e?.message ?? e}` };
  }
  console.error(`autosnapshot: ${last.result}`);
}

function subscribe() {
  if (sock || !autoOn()) return;
  const s = connect(SOCK);
  sock = s;
  let buf = "";
  s.on("connect", () =>
    s.write(JSON.stringify({ id: "autosnap", method: "events.subscribe", params: { subscriptions: TYPES.map((type) => ({ type })) } }) + "\n"),
  );
  s.on("data", (b) => {
    buf += b.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.includes('"event"')) continue;
      // a burst resets the clock; one snapshot once it has been quiet
      if (timer) clearTimeout(timer);
      timer = setTimeout(snapNow, SETTLE_MS);
    }
  });
  s.on("close", () => {
    sock = null;
    if (autoOn()) setTimeout(subscribe, 3000);
  });
  s.on("error", () => {});
}

export function setAuto(on: boolean): string {
  mkdirSync(`${import.meta.dir}/.tmp`, { recursive: true });
  writeFileSync(FLAG, on ? "on\n" : "off\n");
  if (on) subscribe();
  else {
    sock?.destroy();
    sock = null;
    if (timer) clearTimeout(timer);
    timer = null;
  }
  return autoStatus();
}

/** Called once at server boot. */
export function startAutoSnapshot() {
  subscribe();
}
