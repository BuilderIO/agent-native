import { useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type PickerOption = { value: string; label: string };

const triggerClass =
  "h-7 w-auto min-w-0 max-w-[260px] gap-1.5 rounded-md border-transparent bg-muted px-2 py-0 text-sm font-medium shadow-none";

/** A select whose label is the chosen option, so the control names its value. */
export function Picker({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string | undefined;
  options: PickerOption[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const chosen = options.find((option) => option.value === value);
  const label = chosen?.label ?? placeholder;
  return (
    <Select value={chosen ? chosen.value : ""} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={triggerClass}>
        <span className={cn("truncate", !chosen && "text-muted-foreground")}>
          {label}
        </span>
        <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MultiPicker({
  selected,
  options,
  placeholder,
  onChange,
}: {
  selected: string[];
  options: PickerOption[];
  placeholder: string;
  onChange: (selected: string[]) => void;
}) {
  const t = useT();
  const chosen = options.filter((option) => selected.includes(option.value));
  const label = chosen.length
    ? chosen.map((option) => option.label).join(", ")
    : placeholder;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={placeholder}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md bg-muted px-2 text-sm font-medium",
          triggerClass,
        )}
      >
        <span
          className={cn("truncate", !chosen.length && "text-muted-foreground")}
        >
          {label}
        </span>
        <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-72 w-60 flex-col gap-0.5 overflow-y-auto p-1"
      >
        {options.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            {t("forms.editor.nothingToPick")}
          </p>
        ) : null}
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() =>
                onChange(
                  on
                    ? selected.filter((id) => id !== option.value)
                    : [...selected, option.value],
                )
              }
            >
              <span className="flex size-4 items-center justify-center">
                {on ? <IconCheck className="size-4" /> : null}
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
