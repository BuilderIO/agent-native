import { BarChart3, LineChart, Table2, Hash } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ChartType } from "../types";

const CHART_TYPES: {
  value: ChartType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "line", label: "Line", icon: <LineChart className="h-4 w-4" /> },
  { value: "bar", label: "Bar", icon: <BarChart3 className="h-4 w-4" /> },
  { value: "table", label: "Table", icon: <Table2 className="h-4 w-4" /> },
  { value: "metric", label: "Metric", icon: <Hash className="h-4 w-4" /> },
];

interface ChartTypePickerProps {
  value: ChartType;
  onChange: (value: ChartType) => void;
}

export function ChartTypePicker({ value, onChange }: ChartTypePickerProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as ChartType);
      }}
      className="border rounded-md p-0.5"
    >
      {CHART_TYPES.map((ct) => (
        <ToggleGroupItem
          key={ct.value}
          value={ct.value}
          aria-label={ct.label}
          className="h-7 px-2 text-xs gap-1 data-[state=on]:bg-accent"
        >
          {ct.icon}
          {ct.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
