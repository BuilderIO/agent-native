import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Radix Select cannot hold an empty string, so "no filter" travels as this.
const NONE = "__none__";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * A compact filter. `null` is "no filter" and shows `noneLabel`; a value the
 * options do not list (a workflow deleted since) is kept as its own entry so
 * the control never claims no filter is set when one is.
 */
export function FilterSelect({
  label,
  value,
  options,
  noneLabel,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: string | null;
  options: readonly FilterOption[];
  /** The label for no filter; leave it out for a control that always holds a value. */
  noneLabel?: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const known = value === null || options.some((o) => o.value === value);
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn("w-auto min-w-32 max-w-56", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {noneLabel === undefined ? null : (
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
        )}
        {known ? null : <SelectItem value={value}>{value}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
