import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
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
          <Button
            key={slot.start}
            variant={isSelected ? "default" : "outline"}
            onClick={() => onSelect(slot.start)}
          >
            {format(parseISO(slot.start), "h:mm a")}
          </Button>
        );
      })}
    </div>
  );
}
