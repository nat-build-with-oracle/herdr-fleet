/** How much of the fleet to show: live, recent, or all. */
import { SegButton } from "../shared/SegButton";
import { SegGroup } from "../shared/SegGroup";
import { SCOPES, SCOPE_HINT } from "./scope";
import type { Scope } from "./scope";

type Props = {
  scope: Scope;
  /** null until the comparison lands. Printing "live 0 · recent 0 · all 0"
   *  while the remote is still being scanned reads as an empty fleet, not as
   *  a page that has not finished loading. */
  counts: Record<Scope, number> | null;
  onChange: (s: Scope) => void;
};

export function ScopeFilter({ scope, counts, onChange }: Props) {
  return (
    <SegGroup label="How much to show">
      {SCOPES.map((s) => (
        <SegButton key={s} pressed={scope === s} onClick={() => onChange(s)} title={SCOPE_HINT[s]}>
          {s} {counts && <span className="tabular-nums opacity-70">{counts[s]}</span>}
        </SegButton>
      ))}
    </SegGroup>
  );
}
