import { useState } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PropertyCombobox } from "./PropertyCombobox";
import { PropertyValueCombobox } from "./PropertyValueCombobox";
import type { ExplorerFilter } from "../types";

const OPERATORS: { value: ExplorerFilter["operator"]; label: string }[] = [
  { value: "=", label: "=" },
  { value: "!=", label: "!=" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" },
];

const NO_VALUE_OPS = new Set(["is_set", "is_not_set"]);

interface FilterBuilderProps {
  filters: ExplorerFilter[];
  onChange: (filters: ExplorerFilter[]) => void;
}

export function FilterBuilder({ filters, onChange }: FilterBuilderProps) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-1">
      {filters.map((filter, i) => (
        <FilterRow
          key={i}
          filter={filter}
          onChange={(f) => {
            const next = [...filters];
            next[i] = f;
            onChange(next);
          }}
          onRemove={() => onChange(filters.filter((_, j) => j !== i))}
        />
      ))}
      {adding ? (
        <div className="pl-4">
          <PropertyCombobox
            value=""
            autoOpen
            onChange={(property) => {
              onChange([...filters, { property, operator: "=", value: "" }]);
              setAdding(false);
            }}
            triggerLabel="Pick a property to filter"
          />
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-muted-foreground ml-4"
          onClick={() => setAdding(true)}
        >
          <IconPlus className="h-3 w-3 mr-1" />
          Filter by
        </Button>
      )}
    </div>
  );
}

function FilterRow({
  filter,
  onChange,
  onRemove,
}: {
  filter: ExplorerFilter;
  onChange: (f: ExplorerFilter) => void;
  onRemove: () => void;
}) {
  const needsValue = !NO_VALUE_OPS.has(filter.operator);

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm pl-4">
      <span className="text-muted-foreground text-xs shrink-0">&#9655;</span>
      <PropertyCombobox
        value={filter.property}
        onChange={(property) => onChange({ ...filter, property })}
        triggerLabel="property"
      />
      <Select
        value={filter.operator}
        onValueChange={(op) =>
          onChange({ ...filter, operator: op as ExplorerFilter["operator"] })
        }
      >
        <SelectTrigger className="h-7 w-auto min-w-[60px] text-xs px-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERATORS.map((op) => (
            <SelectItem key={op.value} value={op.value} className="text-xs">
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsValue && (
        <PropertyValueCombobox
          property={filter.property}
          value={filter.value ?? ""}
          onChange={(v) => onChange({ ...filter, value: v })}
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={onRemove}
      >
        <IconX className="h-3 w-3" />
      </Button>
    </div>
  );
}
