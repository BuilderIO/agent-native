import { useT } from "@agent-native/core/client";

import { selectColorClass } from "@/components/custom-fields/editor/config/select-colors";
import { optionsFromConfig } from "@/components/custom-fields/editor/config/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FieldValue, TaskFieldValue } from "@/hooks/use-custom-fields";
import { cn } from "@/lib/utils";

const EMPTY_SELECT_VALUE = "__empty__";

export function SingleSelectValueControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: TaskFieldValue & { type: "single_select" };
  value: FieldValue | null;
  disabled: boolean;
  onChange: (value: FieldValue | null) => void;
}) {
  const t = useT();
  const options = optionsFromConfig(field.config);
  const selected = typeof value === "string" ? value : EMPTY_SELECT_VALUE;

  return (
    <Select
      value={selected}
      disabled={disabled}
      onValueChange={(next) =>
        onChange(next === EMPTY_SELECT_VALUE ? null : next)
      }
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value={EMPTY_SELECT_VALUE}>
            {t("taskFields.noneOption")}
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    selectColorClass(option.color),
                  )}
                />
                {option.name}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
