/** The live status at the end of the filter row: progress, a result, or an
 *  error. role=status so a screen reader hears it without focus moving. */
export type Status = { text: string; kind?: "error" | "ok" };

const TONE = { error: "text-danger", ok: "text-open" } as const;

export function StatusLine({ status }: { status: Status }) {
  return (
    <span
      role="status"
      className={"ms-auto min-w-0 truncate text-xs " + (status.kind ? TONE[status.kind] : "text-muted")}
    >
      {status.text}
    </span>
  );
}
