import { useT } from "@agent-native/core/client/i18n";
import type { ConditionalRule, FormField, FormFieldType } from "@shared/types";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface FieldPropertiesPanelProps {
  field: FormField;
  fields: FormField[];
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

function conditionValueOptions(source: FormField | undefined): string[] {
  if (!source) return [];
  if (hasOptions.includes(source.type)) {
    return (source.options || []).filter(
      (option, index, options) =>
        Boolean(option.trim()) && options.indexOf(option) === index,
    );
  }
  if (source.type === "checkbox") return ["true", "false"];
  if (source.type === "rating") return ["1", "2", "3", "4", "5"];
  return [];
}

function defaultConditionOperator(
  source: FormField,
): ConditionalRule["operator"] {
  return source.type === "multiselect" ? "contains" : "equals";
}

export function FieldPropertiesPanel({
  field,
  fields,
  onChange,
  onDelete,
}: FieldPropertiesPanelProps) {
  const t = useT();
  const [newOption, setNewOption] = useState("");
  const fieldIndex = fields.findIndex((candidate) => candidate.id === field.id);
  const availableFields =
    fieldIndex >= 0
      ? fields.slice(0, fieldIndex)
      : fields.filter((candidate) => candidate.id !== field.id);
  const conditionSource =
    availableFields.find(
      (candidate) => candidate.id === field.conditional?.fieldId,
    ) || availableFields[0];
  const conditionOptions = conditionValueOptions(conditionSource);
  const conditionFieldId = conditionSource?.id || "";
  const conditionOperator =
    field.conditional?.operator ||
    (conditionSource ? defaultConditionOperator(conditionSource) : "equals");
  const conditionValue = field.conditional?.value || conditionOptions[0] || "";

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
          className="h-10 px-3 text-xs text-destructive active:scale-[0.96]"
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

        {availableFields.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <Label className="text-xs">
                    {t("fieldProperties.conditionalVisibility")}
                  </Label>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {t("fieldProperties.conditionalVisibilityDescription")}
                  </p>
                </div>
                <Switch
                  checked={Boolean(field.conditional)}
                  onCheckedChange={(checked) => {
                    if (!checked) {
                      update({ conditional: undefined });
                      return;
                    }
                    if (!conditionSource) return;
                    update({
                      conditional: {
                        fieldId: conditionSource.id,
                        operator: defaultConditionOperator(conditionSource),
                        value: conditionOptions[0] || "",
                      },
                    });
                  }}
                />
              </div>

              {field.conditional && conditionSource && (
                <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2.5">
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {t("fieldProperties.conditionField")}
                    </Label>
                    <Select
                      value={conditionFieldId}
                      onValueChange={(value) => {
                        const nextSource = availableFields.find(
                          (candidate) => candidate.id === value,
                        );
                        if (!nextSource) return;
                        const nextOptions = conditionValueOptions(nextSource);
                        update({
                          conditional: {
                            fieldId: nextSource.id,
                            operator: defaultConditionOperator(nextSource),
                            value: nextOptions[0] || "",
                          },
                        });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableFields.map((candidate) => (
                          <SelectItem
                            key={candidate.id}
                            value={candidate.id}
                            className="text-xs"
                          >
                            {candidate.label || candidate.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {t("fieldProperties.conditionOperator")}
                    </Label>
                    <Select
                      value={conditionOperator}
                      onValueChange={(value) =>
                        update({
                          conditional: {
                            fieldId: conditionFieldId,
                            operator: value as ConditionalRule["operator"],
                            value: conditionValue,
                          },
                        })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equals" className="text-xs">
                          {t("fieldProperties.conditionEquals")}
                        </SelectItem>
                        <SelectItem value="not_equals" className="text-xs">
                          {t("fieldProperties.conditionNotEquals")}
                        </SelectItem>
                        <SelectItem value="contains" className="text-xs">
                          {t("fieldProperties.conditionContains")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {t("fieldProperties.conditionValue")}
                    </Label>
                    {conditionOptions.length > 0 ? (
                      <Select
                        value={conditionValue}
                        onValueChange={(value) =>
                          update({
                            conditional: {
                              fieldId: conditionFieldId,
                              operator: conditionOperator,
                              value,
                            },
                          })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {conditionOptions.map((option) => (
                            <SelectItem
                              key={option}
                              value={option}
                              className="text-xs"
                            >
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={conditionValue}
                        onChange={(event) =>
                          update({
                            conditional: {
                              fieldId: conditionFieldId,
                              operator: conditionOperator,
                              value: event.target.value,
                            },
                          })
                        }
                        placeholder={t(
                          "fieldProperties.conditionValuePlaceholder",
                        )}
                        className="h-8 text-xs"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

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
                    className="relative h-10 w-10 shrink-0 p-0 transition-transform duration-150 ease-out before:absolute before:-inset-1 active:scale-[0.96] motion-reduce:active:scale-100 sm:h-7 sm:w-7"
                    onClick={() => removeOption(i)}
                    aria-label={t("fieldProperties.removeOption", {
                      option: opt,
                    })}
                  >
                    <IconX className="h-3.5 w-3.5 translate-y-px" />
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
                  className="relative h-10 w-10 shrink-0 p-0 transition-transform duration-150 ease-out before:absolute before:-inset-1 active:scale-[0.96] motion-reduce:active:scale-100 sm:h-7 sm:w-7"
                  onClick={addOption}
                  aria-label={t("fieldProperties.addOption")}
                >
                  <IconPlus className="h-3.5 w-3.5 translate-y-px" />
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
