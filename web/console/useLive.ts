/** The console's line to the hub: state transitions pushed as they happen, a
 *  nudge to re-read the tree after any action (from any surface -- the CLI, an
 *  agent over MCP), and which panes have a fleet bridge.
 *
 *  Reconnects with backoff. While it is down, `live` is false and the callers
 *  fall back to polling, so a server restart never leaves the page frozen. */
import { useEffect, useRef, useState } from "react";
import { hubUrl } from "./api";
import type { FleetEvent } from "./types";

type Handlers = { onEvent: (e: FleetEvent) => void; onTree: () => void };

export function useLive({ onEvent, onTree }: Handlers) {
  const [live, setLive] = useState(false);
  const [bridges, setBridges] = useState<string[]>([]);
  const h = useRef({ onEvent, onTree });
  h.current = { onEvent, onTree };

  useEffect(() => {
    const url = hubUrl();
    if (!url) return;
    let ws: WebSocket | null = null;
    let delay = 1000;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket(url);
      ws.onopen = () => {
        delay = 1000;
        setLive(true);
      };
      ws.onmessage = (e) => {
        let m: any;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (m.type === "event") h.current.onEvent(m.event);
        else if (m.type === "tree") h.current.onTree();
        else if (m.type === "presence") setBridges(m.panes ?? []);
      };
      ws.onclose = () => {
        setLive(false);
        if (stopped) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return { live, bridges };
}
