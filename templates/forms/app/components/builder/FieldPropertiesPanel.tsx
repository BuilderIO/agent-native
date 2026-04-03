import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { IconPlus, IconX } from "@tabler/icons-react";
import type { FormField, FormFieldType } from "@shared/types";

interface FieldPropertiesPanelProps {
  field: FormField;
  onChange: (field: FormField) => void;
  onDelete: () => void;
}

const fieldTypeLabels: Record<FormFieldType, string> = {
  text: "Short Text",
  email: "Email",
  number: "Number",
  textarea: "Long Text",
  select: "Dropdown",
  multiselect: "Multi-select",
  checkbox: "Checkbox",
  radio: "Radio Buttons",
  date: "Date",
  rating: "Rating",
  scale: "Scale",
};

const hasOptions: FormFieldType[] = ["select", "multiselect", "radio"];

export function FieldPropertiesPanel({
  field,
  onChange,
  onDelete,
}: FieldPropertiesPanelProps) {
  const [newOption, setNewOption] = useState("");

  function update(partial: Partial<FormField>) {
    onChange({ ...field, ...partial });
  }

  function addOption() {
    if (!newOption.trim()) return;
    update({ options: [...(field.options || []), newOption.trim()] });
    setNewOption("");
  }

  function removeOption(index: number) {
    const next = [...(field.options || [])];
    next.splice(index, 1);
    update({ options: next });
  }

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Field Properties</h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive h-7 px-2 text-xs"
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>

      <div className="space-y-3">
        {/* Field type */}
        <div className="space-y-1.5">
          <Label className="text-xs">Type</Label>
          <Select
            value={field.type}
            onValueChange={(v) => update({ type: v as FormFieldType })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(fieldTypeLabels).map(([value, label]) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Label */}
        <div className="space-y-1.5">
          <Label className="text-xs">Label</Label>
          <Input
            value={field.label}
            onChange={(e) => update({ label: e.target.value })}
            className="h-8 text-xs"
          />
        </div>

        {/* Placeholder */}
        <div className="space-y-1.5">
          <Label className="text-xs">Placeholder</Label>
          <Input
            value={field.placeholder || ""}
            onChange={(e) => update({ placeholder: e.target.value })}
            className="h-8 text-xs"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs">Help text</Label>
          <Textarea
            value={field.description || ""}
            onChange={(e) => update({ description: e.target.value })}
            rows={2}
            className="text-xs"
          />
        </div>

        <Separator />

        {/* Required */}
        <div className="flex items-center justify-between">
          <Label className="text-xs">Required</Label>
          <Switch
            checked={field.required}
            onCheckedChange={(checked) => update({ required: checked })}
          />
        </div>

        {/* Width */}
        <div className="space-y-1.5">
          <Label className="text-xs">Width</Label>
          <Select
            value={field.width || "full"}
            onValueChange={(v) => update({ width: v as "full" | "half" })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full" className="text-xs">
                Full width
              </SelectItem>
              <SelectItem value="half" className="text-xs">
                Half width
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Options (for select/radio/multiselect) */}
        {hasOptions.includes(field.type) && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label className="text-xs">Options</Label>
              {(field.options || []).map((opt, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Input
                    value={opt}
                    onChange={(e) => {
                      const next = [...(field.options || [])];
                      next[i] = e.target.value;
                      update({ options: next });
                    }}
                    className="h-7 text-xs flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => removeOption(i)}
                    aria-label={`Remove option ${opt}`}
                  >
                    <IconX className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder="Add option..."
                  className="h-7 text-xs flex-1"
                  onKeyDown={(e) => e.key === "Enter" && addOption()}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={addOption}
                  aria-label="Add option"
                >
                  <IconPlus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Validation for number/scale */}
        {(field.type === "number" || field.type === "scale") && (
          <>
            <Separator />
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Min</Label>
                <Input
                  type="number"
                  value={field.validation?.min ?? ""}
                  onChange={(e) =>
                    update({
                      validation: {
                        ...field.validation,
                        min: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      },
                    })
                  }
                  className="h-7 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Max</Label>
                <Input
                  type="number"
                  value={field.validation?.max ?? ""}
                  onChange={(e) =>
                    update({
                      validation: {
                        ...field.validation,
                        max: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      },
                    })
                  }
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
