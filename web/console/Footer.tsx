/** One line of facts about the page itself: how fresh, and how exposed. */
import { formatAge } from "../shared/time";

type Props = { scannedAt: number; now: number; live: boolean; bridges: number };

/** live = the hub socket is up and events are pushed; polling = the fallback.
 *  "agents on fleet" = panes whose Claude has a connected fleet bridge. */
export function Footer({ scannedAt, now, live, bridges }: Props) {
  const age = scannedAt ? formatAge(scannedAt, now) : null;
  const bits = [
    live ? "live" : "polling",
    `${bridges} agent${bridges === 1 ? "" : "s"} on fleet`,
    age === null ? "scanned —" : age === "now" ? "scanned just now" : `scanned ${age} ago`,
    "127.0.0.1 only",
    "token-gated",
    "fleet",
  ];
  return (
    <footer className="mx-auto flex max-w-[1200px] flex-wrap gap-2 border-t border-rule px-4 py-3 font-mono text-xs text-muted sm:px-8">
      {bits.map((b, i) => (
        <span key={b} className="contents">
          {i > 0 && <span className="text-rule">{"·"}</span>}
          <span>{b}</span>
        </span>
      ))}
    </footer>
  );
}
