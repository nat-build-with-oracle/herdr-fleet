/** One action on a row. Disabled when the verb makes no sense in the row's
 *  current state; busy while its own request is in flight. */
import { ACT, ACT_DANGER } from "../shared/styles";

type Props = {
  label: string;
  enabled: boolean;
  busy: boolean;
  danger?: boolean;
  onRun: () => void;
};

export function ActButton({ label, enabled, busy, danger, onRun }: Props) {
  return (
    <button
      type="button"
      className={ACT + (danger ? " " + ACT_DANGER : "")}
      disabled={!enabled || busy}
      aria-busy={busy || undefined}
      onClick={onRun}
    >
      {label}
    </button>
  );
}
