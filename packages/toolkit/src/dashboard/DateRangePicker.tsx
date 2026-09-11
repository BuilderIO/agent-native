import { Button } from "../ui/button.js";
import { cn } from "../utils.js";

export type DateRange = "7d" | "30d" | "90d";

export interface DateRangeOption {
  value: DateRange;
  label: string;
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  options?: DateRangeOption[];
  className?: string;
}

export const DEFAULT_DATE_RANGE_OPTIONS: DateRangeOption[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

export function dateRangeToInterval(range: DateRange): number {
  return Number.parseInt(range, 10);
}

export function DateRangePicker({
  value,
  onChange,
  options = DEFAULT_DATE_RANGE_OPTIONS,
  className,
}: DateRangePickerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-border p-1",
        className,
      )}
    >
      {options.map((option) => (
        <Button
          key={option.value}
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-3 text-xs",
            value === option.value && "bg-secondary text-secondary-foreground",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
