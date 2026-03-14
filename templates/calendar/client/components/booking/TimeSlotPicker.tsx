import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface TimeSlotPickerProps {
  slots: { start: string; end: string }[];
  selectedSlot: string | null;
  onSelect: (start: string) => void;
  loading?: boolean;
}

export function TimeSlotPicker({
  slots,
  selectedSlot,
  onSelect,
  loading,
}: TimeSlotPickerProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-md" />
        ))}
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No available slots for this date.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {slots.map((slot) => {
        const isSelected = selectedSlot === slot.start;
        return (
          <button
            key={slot.start}
            onClick={() => onSelect(slot.start)}
            className={cn(
              "rounded-md border px-3 py-2 text-sm transition-colors",
              isSelected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary/50 hover:bg-accent",
            )}
          >
            {format(parseISO(slot.start), "h:mm a")}
          </button>
        );
      })}
    </div>
  );
}
