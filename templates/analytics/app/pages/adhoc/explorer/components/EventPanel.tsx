import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconPlus } from "@tabler/icons-react";

import type { ExplorerEvent } from "../types";
import { createDefaultEvent } from "../types";
import { EventRow } from "./EventRow";

interface EventPanelProps {
  events: ExplorerEvent[];
  onChange: (events: ExplorerEvent[]) => void;
}

export function EventPanel({ events, onChange }: EventPanelProps) {
  const t = useT();
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
      <div className="text-sm font-medium text-muted-foreground">
        {t("explorer.events")}
      </div>
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
        {t("explorer.addEvent")}
      </Button>
    </div>
  );
}
