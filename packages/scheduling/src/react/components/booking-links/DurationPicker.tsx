/**
 * DurationPicker — multi-select of booking durations rendered as pills.
 *
 * Bookers will pick between the selected durations on the public booking
 * page (if more than one is selected). Shows 15/30/45/60 as default
 * presets; the user can type an arbitrary number and add it too.
 *
 * Shadcn primitives expected in the consumer: button, input, label.
 */
import { useState } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DEFAULT_PRESETS = [15, 30, 45, 60];

export interface DurationPickerProps {
  value: number[];
  onChange: (next: number[]) => void;
  presets?: number[];
  /** Minimum valid duration, defaults to 5 (minutes). */
  min?: number;
}

function cls(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function DurationPicker(props: DurationPickerProps) {
  const { value, onChange, presets = DEFAULT_PRESETS, min = 5 } = props;
  const [custom, setCustom] = useState(15);

  const toggle = (mins: number) => {
    const next = value.includes(mins)
      ? value.filter((d) => d !== mins)
      : [...value, mins].sort((a, b) => a - b);
    if (next.length === 0) return; // keep at least one
    onChange(next);
  };

  const add = () => {
    if (!custom || custom < min) return;
    if (value.includes(custom)) return;
    onChange([...value, custom].sort((a, b) => a - b));
  };

  const remove = (mins: number) => {
    const next = value.filter((d) => d !== mins);
    if (next.length === 0) return;
    onChange(next);
  };

  // Union of presets + selected values → pill row.
  const pillOptions = Array.from(new Set([...presets, ...value])).sort(
    (a, b) => a - b,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {pillOptions.map((mins) => {
          const isSelected = value.includes(mins);
          const isCustom = !presets.includes(mins);
          return (
            <button
              key={mins}
              type="button"
              onClick={() => toggle(mins)}
              className={cls(
                "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm",
                isSelected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {mins} min
              {isSelected && isCustom && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(mins);
                  }}
                  className="rounded hover:bg-background"
                >
                  <IconX className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          className="w-24"
          value={custom}
          onChange={(e) => setCustom(Number(e.currentTarget.value))}
          min={min}
        />
        <span className="text-sm text-muted-foreground">minutes</span>
        <Button size="sm" variant="outline" onClick={add}>
          <IconPlus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {value.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Bookers will choose between: {value.map((d) => `${d} min`).join(", ")}
        </p>
      )}
    </div>
  );
}
