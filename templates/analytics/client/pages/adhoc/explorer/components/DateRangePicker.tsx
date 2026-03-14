import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DateRange } from "../types";

const OPTIONS: { value: DateRange; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "14d", label: "14D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

interface DateRangePickerProps {
  value: DateRange;
  onChange: (value: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center border rounded-md p-0.5 gap-0.5">
      {OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-2 text-xs",
            value === opt.value && "bg-accent text-accent-foreground"
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
