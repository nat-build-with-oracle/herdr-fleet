/**
 * Fleet data over the herdr API only -- no ssh, no socat, no git shelling.
 *
 * Local goes straight to the Unix socket (newline JSON, one request per line).
 * Remote goes through `herdr --machine <profile-id>`, which owns its own SSH
 * bridge internally. That route needs `remote-api-bridge` on the far binary,
 * which lands after 0.9.0: a 0.9.0 host answers
 *   "remote Herdr does not support machine API forwarding"
 * and the fix is `herdr update` there. It only replaces the binary on disk --
 * an endpoint-generation-1 server and its panes keep running, so updating a
 * host does not kill the agents working on it.
 */
import { connect } from "node:net";
import { execFile } from "node:child_process";

export type Machine = {
  id: string;
  label: string;
  target: string;
  session: string;
  enabled: boolean;
};

const HERDR = process.env.HERDR_BIN_PATH ?? "herdr";

function sh(args: string[], timeout = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(HERDR, args, { timeout, maxBuffer: 32 << 20 }, (err, stdout, stderr) => {
      // herdr reports server errors as JSON on stderr with a non-zero exit
      if (err && !stdout) return reject(new Error(stderr.trim() || err.message));
      resolve(stdout);
    });
  });
}

/** One request, one reply, one connection -- the socket takes one JSON line. */
export function socketCall(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const path =
    process.env.HERDR_SOCKET_PATH ?? `${process.env.HOME}/.config/herdr/herdr.sock`;
  return new Promise((resolve, reject) => {
    const c = connect(path);
    let buf = "";
    const done = (fn: () => void) => {
      c.destroy();
      fn();
    };
    const timer = setTimeout(
      () => done(() => reject(new Error(`${method} timed out`))),
      15000,
    );
    c.on("connect", () => c.write(JSON.stringify({ id: "fleet", method, params }) + "\n"));
    c.on("error", (e: Error) => {
      clearTimeout(timer);
      done(() => reject(e));
    });
    c.on("data", (b: Buffer) => {
      buf += b.toString();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      clearTimeout(timer);
      let msg: any;
      try {
        msg = JSON.parse(buf.slice(0, nl));
      } catch (e) {
        return done(() => reject(e as Error));
      }
      done(() => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
    });
  });
}

export async function machines(): Promise<Machine[]> {
  return JSON.parse(await sh(["machine", "list", "--json"]));
}
