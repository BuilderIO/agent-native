import { useT } from "@agent-native/core/client";
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
import { cn } from "@/lib/utils";

import { SELECT_COLOR_OPTIONS } from "./select-colors";
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
  const t = useT();
  const options = optionsFromConfig(config);

  function updateOption(
    index: number,
    patch: Partial<(typeof options)[number]>,
  ) {
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
          name: t("fieldEditor.newOptionName", { index: nextIndex }),
          color: "gray",
          sortOrder: options.length * 1000,
        },
      ],
    });
  }

  return (
    <div className="grid gap-2">
      <Label>{t("fieldEditor.optionsLabel")}</Label>
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
              aria-label={t("fieldEditor.optionNameAriaLabel", {
                index: index + 1,
              })}
            />
            <Select
              disabled={disabled}
              value={option.color ?? "gray"}
              onValueChange={(value) =>
                updateOption(index, { color: value as SelectColorToken })
              }
            >
              <SelectTrigger
                aria-label={t("fieldEditor.optionColorAriaLabel", {
                  name: option.name,
                })}
              >
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
                        {t(color.labelKey)}
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
              aria-label={t("fieldEditor.removeOptionAriaLabel", {
                name: option.name,
              })}
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
          {t("fieldEditor.addOptionButton")}
        </Button>
      </div>
    </div>
  );
}
