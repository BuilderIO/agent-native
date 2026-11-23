import { useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ResultField } from "../../../shared/notebook-result-contract";
import {
  pivotFormatRuleSchema,
  type PivotConfigV2,
} from "../../../shared/pivot-config";
import {
  PIVOT_AXIS_LIMIT,
  PIVOT_VALUE_LIMIT,
  type NotebookTransform,
} from "../../../shared/visualization-contracts";
import { TABLE_FILTER_LABELS } from "./table-cell-display";

type Aggregation = PivotConfigV2["values"][number]["aggregation"];
const numberAggregates: Aggregation[] = [
  "sum",
  "count",
  "average",
  "min",
  "max",
  "count-distinct",
  "median",
];
const otherAggregates: Aggregation[] = ["count", "count-distinct"];

function isNumeric(field: ResultField): boolean {
  return (
    field.type === "number" ||
    field.type === "integer" ||
    field.type === "decimal"
  );
}

function PickOption({
  label,
  placeholder = label,
  options,
  disabled,
  value = "",
  displayValue,
  onPick,
}: {
  label: string;
  placeholder?: string;
  options: readonly { value: string; label: string }[];
  disabled: boolean;
  value?: string;
  displayValue?: string;
  onPick: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled || options.length === 0}
      onValueChange={onPick}
    >
      <SelectTrigger size="sm" className="min-w-0" aria-label={label}>
        <SelectValue placeholder={placeholder}>{displayValue}</SelectValue>
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

function RemoveField({
  name,
  disabled,
  onRemove,
}: {
  name: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-7 shrink-0"
      aria-label={t("pivot.removeField", { field: name })}
      disabled={disabled}
      onClick={onRemove}
    >
      <IconX size={14} aria-hidden="true" />
    </Button>
  );
}

function PivotConditionalFormatting({
  config,
  name,
  disabled,
  onChange,
}: {
  config: PivotConfigV2;
  name: (fieldId: string) => string;
  disabled: boolean;
  onChange: (patch: Partial<PivotConfigV2>) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selectedMeasure, setSelectedMeasure] = useState("");
  const [op, setOp] = useState("gt");
  const [value, setValue] = useState("");
  const rules = config.formatRules ?? [];
  const measures = config.values.map((measure) => ({
    value: measure.measureId,
    label: t("pivot.measureLabel", {
      aggregation: t(`pivot.aggregations.${measure.aggregation}`),
      field: name(measure.fieldId),
    }),
  }));
  const measureId = measures.some(({ value }) => value === selectedMeasure)
    ? selectedMeasure
    : (measures[0]?.value ?? "");
  const operators = pivotFormatRuleSchema.shape.op.options.map((op) => ({
    value: op,
    label: t(`notebook.displayFilters.operators.${TABLE_FILTER_LABELS[op]}`),
  }));
  const label = t("notebook.tableCell.conditionalFormatting");
  const rule = pivotFormatRuleSchema.safeParse({
    measureId,
    op,
    value: value.trim() === "" ? undefined : Number(value),
  });
  const canSave = !disabled && rule.success && rules.length < 32;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !measures.length}
        >
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            onChange({ formatRules: [...rules, rule.data] });
            setValue("");
            setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          {rules.map((rule, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>
                {measures.find(({ value }) => value === rule.measureId)?.label}{" "}
                {operators.find(({ value }) => value === rule.op)?.label}{" "}
                {rule.value}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("notebook.tableCell.removeRule")}
                disabled={disabled}
                onClick={() =>
                  onChange({
                    formatRules: rules.filter(
                      (_, position) => position !== index,
                    ),
                  })
                }
              >
                <IconX size={14} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <PickOption
            label={t("pivot.values")}
            options={measures}
            value={measureId}
            onPick={setSelectedMeasure}
            disabled={disabled}
          />
          <PickOption
            label={t("notebook.displayFilters.operator", {
              column:
                measures.find(({ value }) => value === measureId)?.label ?? "",
              index: 1,
            })}
            options={operators}
            value={op}
            onPick={setOp}
            disabled={disabled}
          />
          <Input
            type="number"
            step="any"
            aria-label={t("notebook.filterValue")}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
          <DialogFooter>
            <Button type="submit" disabled={!canSave}>
              {t("notebook.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VisualizationDataPanel({
  config,
  sources,
  disabled,
  onChange,
}: {
  config: PivotConfigV2;
  sources: NotebookTransform["sources"];
  disabled: boolean;
  onChange: (patch: Partial<PivotConfigV2>) => void;
}) {
  const t = useT();
  const totalsId = useId();
  const source = sources.find(
    ({ binding }) =>
      config.source?.cellId === binding.cellId &&
      config.source.exportId === binding.exportId,
  );
  const fields = source?.fields ?? [];
  const fieldsById = new Map(
    fields.map((field) => [String(field.fieldId), field]),
  );
  const lookupName = (id: string) => fieldsById.get(id)?.name ?? id;
  const fieldOptions = fields.map(({ fieldId, name }) => ({
    value: fieldId,
    label: name,
  }));
  const orientationLabel = t(
    config.orientation === "columns" ? "pivot.asColumns" : "pivot.asRows",
  );
  return (
    <div className="grid min-w-0 gap-3 px-3 pb-3">
      <div className="min-w-0 sm:max-w-64">
        <PickOption
          label={t("pivot.chooseSource")}
          options={sources.map(({ binding, name }) => ({
            value: binding.resultId,
            label: name,
          }))}
          disabled={disabled}
          value={source?.binding.resultId ?? ""}
          onPick={(value) => {
            const next = sources.find(
              ({ binding }) => binding.resultId === value,
            );
            if (!next) return;
            const sameProducer =
              config.source?.cellId === next.binding.cellId &&
              config.source.exportId === next.binding.exportId;
            const binding = {
              cellId: next.binding.cellId,
              exportId: next.binding.exportId,
            };
            onChange(
              sameProducer
                ? { source: binding }
                : {
                    source: binding,
                    rows: [],
                    columns: [],
                    values: [],
                    filters: [],
                    formatRules: [],
                  },
            );
          }}
        />
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        {(["rows", "columns"] as const).map((axis) => {
          const rows = axis === "rows";
          return (
            <fieldset key={axis} className="grid min-w-0 content-start gap-1.5">
              <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t(
                  rows
                    ? "visualization.charts.pivotRows"
                    : "visualization.charts.pivotColumns",
                )}
              </legend>
              {source &&
                config[axis].map((id) => (
                  <div
                    key={id}
                    className="flex min-w-0 items-center justify-between gap-1 rounded-md border ps-2 text-sm"
                  >
                    <span className="truncate">{lookupName(id)}</span>
                    <RemoveField
                      name={lookupName(id)}
                      disabled={disabled}
                      onRemove={() =>
                        onChange({
                          [axis]: config[axis].filter(
                            (fieldId) => fieldId !== id,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              <PickOption
                label={t(rows ? "pivot.addRow" : "pivot.addColumn")}
                options={fieldOptions.filter(
                  ({ value }) =>
                    !config.rows.includes(value) &&
                    !config.columns.includes(value),
                )}
                disabled={disabled || config[axis].length >= PIVOT_AXIS_LIMIT}
                onPick={(value) =>
                  onChange({ [axis]: [...config[axis], value] })
                }
              />
            </fieldset>
          );
        })}
        <fieldset className="grid min-w-0 content-start gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("pivot.values")}
          </legend>
          {source &&
            config.values.map(({ fieldId, aggregation, measureId }, index) => {
              const field = fieldsById.get(fieldId);
              const name = lookupName(fieldId);
              const measureLabel = t("pivot.measureLabel", {
                aggregation: t(`pivot.aggregations.${aggregation}`),
                field: name,
              });
              const aggregates =
                field &&
                (isNumeric(field) ? numberAggregates : otherAggregates);
              return (
                <div
                  key={measureId}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1"
                >
                  <PickOption
                    label={measureLabel}
                    displayValue={measureLabel}
                    options={
                      aggregates?.map((value) => ({
                        value,
                        label: t(`pivot.aggregations.${value}`),
                      })) ?? []
                    }
                    value={field ? aggregation : ""}
                    disabled={disabled}
                    onPick={(value) => {
                      const selected = aggregates?.find(
                        (choice) => choice === value,
                      );
                      if (selected) {
                        onChange({
                          values: config.values.map((measure, position) =>
                            position === index
                              ? { ...measure, aggregation: selected }
                              : measure,
                          ),
                        });
                      }
                    }}
                  />
                  <RemoveField
                    name={name}
                    disabled={disabled}
                    onRemove={() =>
                      onChange({
                        values: config.values.filter(
                          (_, position) => position !== index,
                        ),
                        formatRules:
                          config.formatRules?.filter(
                            (rule) => rule.measureId !== measureId,
                          ) ?? [],
                      })
                    }
                  />
                </div>
              );
            })}
          <PickOption
            label={t("pivot.addValue")}
            options={fieldOptions}
            disabled={disabled || config.values.length >= PIVOT_VALUE_LIMIT}
            onPick={(fieldId) => {
              const field = fieldsById.get(fieldId);
              if (field) {
                onChange({
                  values: [
                    ...config.values,
                    {
                      measureId: crypto.randomUUID(),
                      fieldId,
                      aggregation: isNumeric(field) ? "sum" : "count",
                    },
                  ],
                });
              }
            }}
          />
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {config.values.length > 1 && (
          <div className="min-w-32">
            <PickOption
              label={orientationLabel}
              displayValue={orientationLabel}
              value={config.orientation}
              options={[
                { value: "columns", label: t("pivot.asColumns") },
                { value: "rows", label: t("pivot.asRows") },
              ]}
              disabled={disabled}
              onPick={(orientation) =>
                onChange({
                  orientation: orientation === "rows" ? "rows" : "columns",
                })
              }
            />
          </div>
        )}
        {(["rowTotals", "columnTotals", "subtotals"] as const).map((key) => {
          const id = `${totalsId}-${key}`;
          return (
            <label
              key={key}
              htmlFor={id}
              className="flex items-center gap-2 text-xs"
            >
              <Checkbox
                id={id}
                checked={config[key]}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange({ [key]: checked === true })
                }
              />
              {t(
                key === "rowTotals"
                  ? "visualization.charts.pivotShowRowTotals"
                  : key === "columnTotals"
                    ? "visualization.charts.pivotShowColumnTotals"
                    : "pivot.showSubtotals",
              )}
            </label>
          );
        })}
        <PivotConditionalFormatting
          config={config}
          name={lookupName}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
