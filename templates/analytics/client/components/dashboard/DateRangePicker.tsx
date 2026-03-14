import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DateRange = "7d" | "30d" | "90d";

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const options: { value: DateRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

export function dateRangeToInterval(range: DateRange): number {
  switch (range) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
  }
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-1">
      {options.map((opt) => (
        <Button
          key={opt.value}
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-3 text-xs",
            value === opt.value &&
              "bg-secondary text-secondary-foreground"
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
