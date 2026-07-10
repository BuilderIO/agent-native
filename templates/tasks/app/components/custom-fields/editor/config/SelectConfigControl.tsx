import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SelectColorToken } from "@/hooks/use-custom-fields";
import { SELECT_COLOR_OPTIONS } from "./select-colors";
import { cn } from "@/lib/utils";
import {
  type FieldConfigControlProps,
  optionsFromConfig,
  withSortedOptions,
} from "./utils";

export function SelectConfigControl({
  config,
  onChange,
  disabled = false,
}: FieldConfigControlProps) {
  const options = optionsFromConfig(config);

  function updateOption(index: number, patch: Partial<(typeof options)[number]>) {
    onChange({
      options: withSortedOptions(
        options.map((option, optionIndex) =>
          optionIndex === index ? { ...option, ...patch } : option,
        ),
      ),
    });
  }

  function removeOption(index: number) {
    onChange({
      options: withSortedOptions(
        options.filter((_, optionIndex) => optionIndex !== index),
      ),
    });
  }

  function addOption() {
    const nextIndex = options.length + 1;
    onChange({
      options: [
        ...options,
        {
          id: `opt_${crypto.randomUUID()}`,
          name: `Option ${nextIndex}`,
          color: "gray",
          sortOrder: options.length * 1000,
        },
      ],
    });
  }

  return (
    <div className="grid gap-2">
      <Label>Options</Label>
      <div className="grid gap-2">
        {options.map((option, index) => (
          <div
            key={`${option.id || "new"}-${index}`}
            className="grid grid-cols-[1fr_136px_32px] items-center gap-2"
          >
            <Input
              disabled={disabled}
              value={option.name}
              onChange={(event) =>
                updateOption(index, { name: event.currentTarget.value })
              }
              aria-label={`Option ${index + 1} name`}
            />
            <Select
              disabled={disabled}
              value={option.color ?? "gray"}
              onValueChange={(value) =>
                updateOption(index, { color: value as SelectColorToken })
              }
            >
              <SelectTrigger aria-label={`Option ${option.name} color`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SELECT_COLOR_OPTIONS.map((color) => (
                    <SelectItem key={color.value} value={color.value}>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn("size-2 rounded-full", color.className)}
                        />
                        {color.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              onClick={() => removeOption(index)}
              aria-label={`Remove ${option.name}`}
            >
              <IconTrash className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={addOption}
          className="justify-self-start gap-2"
        >
          <IconPlus className="size-4" />
          Add option
        </Button>
      </div>
    </div>
  );
}
