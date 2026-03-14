import { GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventCombobox } from "./EventCombobox";
import { FilterBuilder } from "./FilterBuilder";
import { GroupByPicker } from "./GroupByPicker";
import type { ExplorerEvent } from "../types";

interface EventRowProps {
  event: ExplorerEvent;
  onChange: (event: ExplorerEvent) => void;
  onRemove: () => void;
}

export function EventRow({ event, onChange, onRemove }: EventRowProps) {
  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card">
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab" />
        <div className="flex-1 min-w-0">
          <EventCombobox
            value={event.event}
            onChange={(value) => onChange({ ...event, event: value })}
          />
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onRemove}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <FilterBuilder
        filters={event.filters}
        onChange={(filters) => onChange({ ...event, filters })}
      />

      <GroupByPicker
        groupBy={event.groupBy}
        onChange={(groupBy) => onChange({ ...event, groupBy })}
      />
    </div>
  );
}
