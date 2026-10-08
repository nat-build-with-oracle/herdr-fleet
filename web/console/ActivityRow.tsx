/** One transition: when, which worktree, from what to what. */
import { formatAge } from "../shared/time";
import type { FleetEvent } from "./types";

export function ActivityRow({ event, now }: { event: FleetEvent; now: number }) {
  const age = formatAge(event.at, now);
  return (
    <div className="flex items-baseline gap-2 py-px">
      <span className="shrink-0 tabular-nums text-rule">{age === "now" ? "just now" : `${age} ago`}</span>
      <span className="min-w-0 flex-1 truncate">
        {event.repo} / {event.label}
        {"  "}
        {event.from} {"→"} {event.to}
      </span>
    </div>
  );
}
