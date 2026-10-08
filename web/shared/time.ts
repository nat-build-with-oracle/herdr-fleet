/** Compact age and size, as every row on both pages prints them. */

/** "now", "3m", "5h", "2d" -- or null when there is nothing to age. */
export function formatAge(at: number | undefined, now: number): string | null {
  if (at === undefined || at === null) return null;
  const min = Math.floor(Math.max(0, now - at) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/** "3.2MB", or null for an empty or missing size. */
export function formatBytes(bytes: number | undefined): string | null {
  return bytes ? `${(bytes / 1048576).toFixed(1)}MB` : null;
}
