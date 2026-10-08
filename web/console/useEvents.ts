/** State transitions across the fleet, newest first. Polled every 3s -- well
 *  ahead of the 15s tree rescan, so a change shows in the activity strip
 *  before the index catches up. Polls whether or not the strip is open, so
 *  opening it shows history rather than an empty box. A failed poll is
 *  silent; the next tick tries again. */
import { useRef, useState } from "react";
import { fetchEvents } from "./api";
import type { FleetEvent } from "./types";
import { useVisibleInterval } from "./useVisibleInterval";

const KEEP = 200;

export function useEvents(live: boolean) {
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const since = useRef(0);

  /** a transition pushed by the hub */
  const push = (ev: FleetEvent) => {
    since.current = Math.max(since.current, ev.at);
    setEvents((prev) => [ev, ...prev].slice(0, KEEP));
  };

  // polling is the fallback now: only while the hub is not connected
  useVisibleInterval(async () => {
    if (live) return;
    try {
      const out = await fetchEvents(since.current);
      since.current = out.at;
      if (out.events.length) setEvents((prev) => [...out.events, ...prev].slice(0, KEEP));
    } catch {
      // next tick
    }
  }, 3_000);

  return { events, push };
}
