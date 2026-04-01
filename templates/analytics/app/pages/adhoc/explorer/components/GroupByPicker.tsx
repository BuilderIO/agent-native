import { useState } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { PropertyCombobox } from "./PropertyCombobox";

interface GroupByPickerProps {
  groupBy: string[];
  onChange: (groupBy: string[]) => void;
}

export function GroupByPicker({ groupBy, onChange }: GroupByPickerProps) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex items-center gap-1.5 flex-wrap pl-4">
      {groupBy.length > 0 && (
        <span className="text-xs text-muted-foreground">grouped by</span>
      )}
      {groupBy.map((g, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
        >
          <span className="text-muted-foreground">&#9655;</span>
          {g}
          <button
            className="hover:text-destructive"
            onClick={() => onChange(groupBy.filter((_, j) => j !== i))}
          >
            <IconX className="h-3 w-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <PropertyCombobox
          value=""
          autoOpen
          onChange={(prop) => {
            if (!groupBy.includes(prop)) {
              onChange([...groupBy, prop]);
            }
            setAdding(false);
          }}
          triggerLabel="Pick a property"
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-muted-foreground"
          onClick={() => setAdding(true)}
        >
          <IconPlus className="h-3 w-3 mr-1" />
          Group-by
        </Button>
      )}
    </div>
  );
}
