import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";

interface DateRangeInputProps {
  label: string;
  startDate: string;
  endDate: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  className?: string;
}

export function DateRangeInput({
  label,
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  className,
}: DateRangeInputProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="text-xs text-muted-foreground font-medium">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <DatePicker value={startDate} onChange={onStartChange} />
        <span className="text-xs text-muted-foreground">to</span>
        <DatePicker value={endDate} onChange={onEndChange} />
      </div>
    </div>
  );
}

interface SingleDateInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SingleDateInput({
  label,
  value,
  onChange,
  className,
}: SingleDateInputProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="text-xs text-muted-foreground font-medium">
        {label}
      </label>
      <DatePicker value={value} onChange={onChange} />
    </div>
  );
}
