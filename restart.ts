/**
 * Restarting the fleet server from inside itself.
 *
 * A process cannot re-exec in place and keep serving the request that asked
 * for it, so a restart is a hand-over:
 *
 *   1. the running server spawns a detached copy of itself, passing its own
 *      PID in FLEET_WAIT_PID and its own token in FLEET_TOKEN;
 *   2. it answers the caller, then exits a moment later;
 *   3. the copy waits for that PID to be gone -- the port is not free until
 *      it is -- and only then binds.
 *
 * Same port and same token on purpose: the MCP bridge, the tray and any open
 * console page keep working without re-reading runtime.json. And because
 * boot rebuilds web/dist when sources are newer, a restart also picks up
 * edited server code and edited pages in one step.
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";

const WAIT_MS = 10_000;

/** Called first thing on boot: if we are a replacement, let the old one go. */
export async function waitForPredecessor(): Promise<void> {
  const pid = Number(process.env.FLEET_WAIT_PID);
  if (!pid) return;
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0); // signal 0 = "does it exist", sends nothing
    } catch {
      return; // gone
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error(`predecessor ${pid} still alive after ${WAIT_MS}ms; binding anyway`);
}

function logFd(cwd: string): number {
  mkdirSync(`${cwd}/.tmp`, { recursive: true });
  return openSync(`${cwd}/.tmp/server.log`, "a");
}

/** Spawn the replacement and schedule this process's exit. */
export function restartSelf(serverFile: string, cwd: string, token: string, port: number): number {
  const child = spawn("bun", ["run", serverFile], {
    cwd,
    detached: true,
    // the replacement logs to .tmp/server.log, appended -- with "ignore" its
    // diagnostics (a channel warning not accepted, a restart that failed)
    // vanished, and an agent stuck unattended looked like a dead one
    stdio: ["ignore", logFd(cwd), logFd(cwd)],
    env: {
      ...process.env,
      FLEET_WAIT_PID: String(process.pid),
      FLEET_TOKEN: token,
      FLEET_PORT: String(port),
    },
  });
  child.unref();
  // tells this process's exit handler to leave runtime.json for the successor
  process.env.FLEET_HANDOVER = "1";
  // long enough for the reply to flush, short enough that nobody waits on it
  setTimeout(() => process.exit(0), 300);
  return child.pid ?? 0;
}
