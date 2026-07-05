import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Separator } from "@agent-native/toolkit/ui/separator";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import type { FormField, FormFieldType } from "@shared/types";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";

interface FieldPropertiesPanelProps {
  field: FormField;
  onChange: (field: FormField) => void;
  onDelete: () => void;
}

const fieldTypeLabels: Record<FormFieldType, string> = {
  text: "fieldProperties.fieldTypes.text", // i18n-ignore stable catalog key
  email: "fieldProperties.fieldTypes.email", // i18n-ignore stable catalog key
  number: "fieldProperties.fieldTypes.number", // i18n-ignore stable catalog key
  textarea: "fieldProperties.fieldTypes.textarea", // i18n-ignore stable catalog key
  select: "fieldProperties.fieldTypes.select", // i18n-ignore stable catalog key
  multiselect: "fieldProperties.fieldTypes.multiselect", // i18n-ignore stable catalog key
  checkbox: "fieldProperties.fieldTypes.checkbox", // i18n-ignore stable catalog key
  radio: "fieldProperties.fieldTypes.radio", // i18n-ignore stable catalog key
  date: "fieldProperties.fieldTypes.date", // i18n-ignore stable catalog key
  rating: "fieldProperties.fieldTypes.rating", // i18n-ignore stable catalog key
  scale: "fieldProperties.fieldTypes.scale", // i18n-ignore stable catalog key
};

const hasOptions: FormFieldType[] = ["select", "multiselect", "radio"];

export function FieldPropertiesPanel({
  field,
  onChange,
  onDelete,
}: FieldPropertiesPanelProps) {
  const t = useT();
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
        <h3 className="text-sm font-semibold">{t("fieldProperties.title")}</h3>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive h-7 px-2 text-xs"
          onClick={onDelete}
        >
          {t("common.delete")}
        </Button>
      </div>

      <div className="space-y-3">
        {/* Field type */}
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldProperties.type")}</Label>
          <Select
            value={field.type}
            onValueChange={(v) => update({ type: v as FormFieldType })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(fieldTypeLabels).map(([value, labelKey]) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {t(labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Label */}
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldProperties.label")}</Label>
          <Input
            value={field.label}
            onChange={(e) => update({ label: e.target.value })}
            className="h-8 text-xs"
          />
        </div>

        {/* Placeholder */}
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldProperties.placeholder")}</Label>
          <Input
            value={field.placeholder || ""}
            onChange={(e) => update({ placeholder: e.target.value })}
            className="h-8 text-xs"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldProperties.helpText")}</Label>
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
          <Label className="text-xs">{t("fieldProperties.required")}</Label>
          <Switch
            checked={field.required}
            onCheckedChange={(checked) => update({ required: checked })}
          />
        </div>

        {/* Width */}
        <div className="space-y-1.5">
          <Label className="text-xs">{t("fieldProperties.width")}</Label>
          <Select
            value={field.width || "full"}
            onValueChange={(v) => update({ width: v as "full" | "half" })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full" className="text-xs">
                {t("fieldProperties.fullWidth")}
              </SelectItem>
              <SelectItem value="half" className="text-xs">
                {t("fieldProperties.halfWidth")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Options (for select/radio/multiselect) */}
        {hasOptions.includes(field.type) && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label className="text-xs">{t("fieldProperties.options")}</Label>
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
                    aria-label={t("fieldProperties.removeOption", {
                      option: opt,
                    })}
                  >
                    <IconX className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder={t("fieldProperties.addOptionPlaceholder")}
                  className="h-7 text-xs flex-1"
                  onKeyDown={(e) => e.key === "Enter" && addOption()}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={addOption}
                  aria-label={t("fieldProperties.addOption")}
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
                <Label className="text-xs">{t("fieldProperties.min")}</Label>
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
                <Label className="text-xs">{t("fieldProperties.max")}</Label>
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
