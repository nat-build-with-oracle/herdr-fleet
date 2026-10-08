/** State transitions across the fleet, newest first, in a short scrolling
 *  strip under the controls. */
import { ActivityRow } from "./ActivityRow";
import type { FleetEvent } from "./types";

export function ActivityStrip({ events, now }: { events: FleetEvent[]; now: number }) {
  return (
    <div
      className="mx-auto max-h-36 max-w-[1200px] overflow-y-auto border-b border-rule-2 px-4 py-2 font-mono text-xs sm:px-8"
      aria-live="polite"
    >
      {events.length === 0 ? (
        <p className="m-0 text-muted">No state changes observed yet this session.</p>
      ) : (
        events.map((e) => <ActivityRow key={`${e.at}\u0000${e.path}\u0000${e.to}`} event={e} now={now} />)
      )}
    </div>
  );
}
