import { IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { EventRow } from "./EventRow";
import type { ExplorerEvent } from "../types";
import { createDefaultEvent } from "../types";

interface EventPanelProps {
  events: ExplorerEvent[];
  onChange: (events: ExplorerEvent[]) => void;
}

export function EventPanel({ events, onChange }: EventPanelProps) {
  const updateEvent = (index: number, event: ExplorerEvent) => {
    const next = [...events];
    next[index] = event;
    onChange(next);
  };

  const removeEvent = (index: number) => {
    onChange(events.filter((_, i) => i !== index));
  };

  const addEvent = () => {
    onChange([...events, createDefaultEvent()]);
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-muted-foreground">Events</div>
      {events.map((ev, i) => (
        <EventRow
          key={i}
          event={ev}
          onChange={(updated) => updateEvent(i, updated)}
          onRemove={() => removeEvent(i)}
        />
      ))}
      <Button variant="outline" size="sm" className="w-full" onClick={addEvent}>
        <IconPlus className="h-4 w-4 mr-1" />
        Add Event
      </Button>
    </div>
  );
}
