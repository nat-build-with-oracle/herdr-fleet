/** The console's three switches. Toggles, not checkboxes, so they read and
 *  behave like every other control on both pages. */
import { SegButton } from "../shared/SegButton";
import { SegGroup } from "../shared/SegGroup";

export type ViewOpts = { cold: boolean; byAge: boolean; activity: boolean };

const OPTIONS: { key: keyof ViewOpts; label: string; hint: string }[] = [
  { key: "cold", label: "cold", hint: "include worktrees with nothing running and no transcript" },
  { key: "byAge", label: "by age", hint: "one flat list, most recent transcript first" },
  { key: "activity", label: "activity", hint: "state changes across the fleet, newest first" },
];

type Props = { opts: ViewOpts; onToggle: (key: keyof ViewOpts) => void };

export function ViewOptions({ opts, onToggle }: Props) {
  return (
    <SegGroup label="View options">
      {OPTIONS.map((o) => (
        <SegButton key={o.key} pressed={opts[o.key]} onClick={() => onToggle(o.key)} title={o.hint}>
          {o.label}
        </SegButton>
      ))}
    </SegGroup>
  );
}
