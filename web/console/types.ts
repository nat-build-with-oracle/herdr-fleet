/** Shapes only the console reads. Node and State are shared with compare. */

export type Verb = "open" | "resume" | "start" | "restart" | "kill" | "close";

/** One observed state transition, from /api/events. */
export type FleetEvent = {
  at: number;
  path: string;
  repo: string;
  label: string;
  from: string;
  to: string;
};
