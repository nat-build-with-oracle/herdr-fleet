/** The filter field both pages carry. */
import { INPUT } from "./styles";

type Props = { value: string; onChange: (v: string) => void; label: string };

export function SearchInput({ value, onChange, label }: Props) {
  return (
    <input
      type="search"
      className={INPUT}
      placeholder="filter"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
