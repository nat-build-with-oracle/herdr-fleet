/** Every network call the page makes.
 *
 *  Both endpoints are reads, so nothing here carries the server's action
 *  token -- this page cannot start or kill an agent, and it should not hold a
 *  credential that could. */
import type { CompareData, Machine } from "./types";

export async function fetchMachines(): Promise<Machine[]> {
  const r = await fetch("/api/machines");
  if (!r.ok) throw new Error(`/api/machines returned ${r.status}`);
  const body = await r.json();
  return body.machines ?? [];
}

export async function fetchCompare(machineId: string): Promise<CompareData> {
  const r = await fetch("/api/compare?machine=" + encodeURIComponent(machineId));
  const body = await r.json();
  // the server reports its own failures in-band with a 500; prefer its message
  if (body?.error) throw new Error(body.error);
  if (!r.ok) throw new Error(`/api/compare returned ${r.status}`);
  return body as CompareData;
}
