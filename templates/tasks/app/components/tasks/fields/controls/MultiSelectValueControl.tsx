import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { FieldValue, TaskFieldValue } from "@/hooks/use-custom-fields";
import { optionsFromConfig } from "@/components/custom-fields/editor/config/utils";
import { selectColorClass } from "@/components/custom-fields/editor/config/select-colors";

export function MultiSelectValueControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: TaskFieldValue & { type: "multi_select" };
  value: FieldValue | null;
  disabled: boolean;
  onChange: (value: FieldValue | null) => void;
}) {
  const options = optionsFromConfig(field.config);
  const selected = Array.isArray(value) ? value : [];

  return (
    <div className="grid gap-2">
      {options.map((option) => {
        const checked = selected.includes(option.id);
        return (
          <label
            key={option.id}
            className="flex min-h-9 items-center gap-2 rounded-md border border-border/80 bg-background px-2.5 py-2 text-[13px] transition-colors hover:bg-muted/35"
          >
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={(next) => {
                const nextSelected = next
                  ? [...selected, option.id]
                  : selected.filter((optionId) => optionId !== option.id);
                onChange(nextSelected.length > 0 ? nextSelected : null);
              }}
            />
            <span
              className={cn(
                "size-2 rounded-full",
                selectColorClass(option.color),
              )}
            />
            <span className="min-w-0 flex-1 truncate">{option.name}</span>
          </label>
        );
      })}
    </div>
  );
}
