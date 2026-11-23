import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useReaderLocale } from "@agent-native/toolkit/app/shared/reader-locale";
import { IconSettings } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useId, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCachedDateTimeFormat,
  getCachedNumberFormat,
} from "@/lib/intl-cache";
import type { Cell } from "@/lib/model/contracts";

import type getProject from "../../../actions/get-project";
import {
  defaultMetricAggregation,
  metricAggregations,
  type MetricConfig,
} from "../../../shared/metric-config";
import { renderMetricTitle } from "../../../shared/metric-title";
import type { ResultField } from "../../../shared/notebook-result-contract";
import type {
  MetricTransformResult,
  NotebookTransform,
} from "../../../shared/visualization-contracts";
import { mergeSavedCell } from "../workspace/merge-saved-cell";
import { toIntlNumeric } from "./CellOutputView";
import type { VisualizationViewScope } from "./types";

type MetricContents = Extract<Cell["contents"], { kind: "metric" }>;
type MetricFormat = NonNullable<MetricConfig["format"]>;
type ProjectRead = Awaited<ReturnType<typeof getProject.run>>;
type MetricViewProps = {
  context: { projectId: string; cellId: string; versionId: string };
  config: MetricConfig;
  scope?: VisualizationViewScope | undefined;
  sourceResultId?: string | null;
  namedValues?: ReadonlyMap<string, string> | undefined;
};

const numberFormats: readonly MetricFormat[] = [
  "plain",
  "number",
  "percent",
  "scientific",
  "currency",
  "long-currency",
  "financial",
];
const dateFormats: readonly MetricFormat[] = [
  "plain",
  "iso-date",
  "date",
  "long-date",
  "time",
  "date-time",
];
const timeFormats: readonly MetricFormat[] = ["plain", "time"];
const numberOptions: Partial<Record<MetricFormat, Intl.NumberFormatOptions>> = {
  number: { maximumFractionDigits: 20 },
  percent: { style: "percent", maximumFractionDigits: 2 },
  scientific: { notation: "scientific", maximumFractionDigits: 2 },
  currency: { style: "currency", currency: "USD" },
  "long-currency": {
    style: "currency",
    currency: "USD",
    currencyDisplay: "code",
  },
  financial: { style: "currency", currency: "USD", currencySign: "accounting" },
};
const dateOptions: Partial<Record<MetricFormat, Intl.DateTimeFormatOptions>> = {
  date: { dateStyle: "medium" },
  "long-date": { dateStyle: "long" },
  time: { timeStyle: "medium" },
  "date-time": { dateStyle: "medium", timeStyle: "short" },
};

function availableFormats(
  field: ResultField | undefined,
  aggregate: MetricConfig["aggregation"],
): readonly MetricFormat[] {
  if (
    aggregate === "count" ||
    aggregate === "count-distinct" ||
    field?.type === "number" ||
    field?.type === "decimal" ||
    field?.type === "integer"
  )
    return numberFormats;
  if (field?.type === "date" || field?.type === "datetime") return dateFormats;
  if (field?.type === "time") return timeFormats;
  return ["plain"];
}

function effectiveFormat(
  config: MetricConfig,
  formats: readonly MetricFormat[],
) {
  return config.format && formats.includes(config.format)
    ? config.format
    : formats === numberFormats
      ? "number"
      : "plain";
}

function displayValue(
  value: NonNullable<MetricTransformResult["value"]>,
  format: MetricFormat,
  locale: string,
): string {
  const numericOptions = numberOptions[format];
  const numeric = numericOptions ? toIntlNumeric(value) : null;
  if (numericOptions && numeric !== null) {
    return getCachedNumberFormat(locale, numericOptions).format(numeric);
  }
  const temporalOptions = dateOptions[format];
  if (format === "iso-date" || temporalOptions) {
    const raw = String(value);
    const text = /^\d{2}:/.test(raw)
      ? `1970-01-01T${raw}`
      : raw.replace(" ", "T");
    const date = new Date(
      text.length > 10 && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
        ? `${text}Z`
        : text,
    );
    if (!Number.isNaN(date.valueOf())) {
      return temporalOptions
        ? getCachedDateTimeFormat(locale, {
            ...temporalOptions,
            timeZone: "UTC",
          }).format(date)
        : date.toISOString().slice(0, 10);
    }
  }
  return String(value);
}

function useMetricResult({
  context,
  config,
  scope,
  sourceResultId,
}: MetricViewProps) {
  return useActionQuery<NotebookTransform>(
    "get-notebook-transform",
    {
      projectId: context.projectId,
      cellId: context.cellId,
      ...(scope ?? { expectedVersionId: context.versionId }),
      expectedConfigRevision: config.revision,
      mode: "metric",
    },
    { queryKeyScope: [sourceResultId] },
  );
}

function MetricTile({
  config,
  namedValues,
  result,
  pending,
  failed,
  notebook = false,
  gear,
}: Pick<MetricViewProps, "config" | "namedValues"> & {
  result?: NotebookTransform["result"] | undefined;
  pending: boolean;
  failed: boolean;
  notebook?: boolean;
  gear?: ReactNode;
}) {
  const t = useT();
  const locale = useReaderLocale();
  const metric =
    result && "kind" in result && result.kind === "metric" ? result : undefined;
  const value =
    metric?.status === "ready" && metric.value !== null
      ? displayValue(
          metric.value,
          effectiveFormat(
            config,
            availableFormats(metric.field, metric.aggregation),
          ),
          locale,
        )
      : null;
  const title = renderMetricTitle(config.title, namedValues);
  return (
    <div
      className={
        notebook
          ? "@container flex min-h-[123px] w-[250px] max-w-full rounded-md border bg-background"
          : "@container flex min-h-0 w-full flex-1"
      }
    >
      <div
        className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-3"
        aria-busy={pending || undefined}
      >
        {pending ? (
          <Skeleton className="h-9 w-4/5" />
        ) : (
          <div
            className={
              value === null && !notebook
                ? "break-words text-center text-base text-muted-foreground"
                : `break-words text-[clamp(1.5rem,12cqw,3.5rem)] font-semibold leading-tight tabular-nums${value === null ? " text-muted-foreground" : ""}`
            }
          >
            {value ?? t(notebook ? "singleValue.value" : "singleValue.noValue")}
          </div>
        )}
        {title || notebook ? (
          <div
            className={`break-words text-sm${title ? "" : " text-muted-foreground"}`}
          >
            {title || t("singleValue.title")}
          </div>
        ) : null}
        {failed && (
          <span className="text-xs text-muted-foreground" role="alert">
            {t("singleValue.readFailed")}
          </span>
        )}
      </div>
      {gear && <div className="shrink-0 p-1">{gear}</div>}
    </div>
  );
}

export function CompleteMetricView(props: MetricViewProps) {
  const query = useMetricResult(props);
  const result = query.isError ? undefined : query.data?.result;
  return (
    <MetricTile
      config={props.config}
      namedValues={props.namedValues}
      result={result}
      pending={props.config.source !== null && query.isPending}
      failed={query.isError || result?.status === "unreadable"}
    />
  );
}

function MetricSelect<Value extends string>({
  label,
  placeholder,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: Value | undefined;
  options: readonly { value: Value; label: string }[];
  disabled: boolean;
  onChange: (value: Value) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      {label}
      <Select
        value={value ?? ""}
        disabled={disabled || options.length === 0}
        onValueChange={(selection) => {
          const option = options.find((item) => item.value === selection);
          if (option) onChange(option.value);
        }}
      >
        <SelectTrigger size="sm" className="w-full min-w-0" aria-label={label}>
          <SelectValue placeholder={placeholder}>
            {options.find((item) => item.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

const sourceKey = (source: NonNullable<MetricConfig["source"]>) =>
  JSON.stringify([source.cellId, source.exportId]);

export function MetricCell({
  cell,
  contents,
  config: savedConfig,
  canEdit,
  sourceResultId,
  namedValues,
}: {
  cell: Cell;
  contents: MetricContents;
  config: MetricConfig;
  canEdit: boolean;
  sourceResultId: string | null;
  namedValues?: ReadonlyMap<string, string> | undefined;
}) {
  const t = useT();
  const dialogTitle = useId();
  const client = useQueryClient();
  const query = useMetricResult({
    context: {
      projectId: cell.projectId,
      cellId: cell.id,
      versionId: cell.versionId,
    },
    config: savedConfig,
    sourceResultId,
  });
  const projectKey = ["action", "get-project", { projectId: cell.projectId }];
  const save = useActionMutation("save-project-cell", {
    beforeInvalidate: (saved, change) => {
      client.setQueryData<ProjectRead>(projectKey, (current) =>
        current
          ? {
              ...current,
              project: mergeSavedCell(
                current.project,
                saved.project,
                change.cellId,
                change.expectedUpdatedAt,
              ),
            }
          : current,
      );
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: projectKey });
    },
  });
  const draft = save.isPending ? save.variables.contents : undefined;
  const config =
    draft?.kind === "metric" && draft.metricConfig
      ? draft.metricConfig
      : savedConfig;
  const projection = query.isError ? undefined : query.data;
  const result = projection?.result;
  const metric =
    result && "kind" in result && result.kind === "metric" ? result : undefined;
  const sources = projection?.sources ?? [];
  const selectedSource = config.source ? sourceKey(config.source) : undefined;
  const source = sources.find(
    ({ binding }) => sourceKey(binding) === selectedSource,
  );
  const fields = source?.fields ?? [];
  const field =
    config.fieldId === null
      ? fields[0]
      : fields.find(({ fieldId }) => fieldId === config.fieldId);
  const aggregate =
    config.mode === "aggregate" && field
      ? (config.aggregation ?? defaultMetricAggregation(field))
      : null;
  const formats = availableFormats(field, aggregate);
  const disabled = !canEdit || save.isPending || query.isPending;
  const rowCount = metric?.source.rowCount;
  const retry = query.isError || result?.status === "unreadable";

  function changeConfig(patch: Partial<MetricConfig>) {
    if (disabled) return;
    save.mutate({
      projectId: cell.projectId,
      cellId: cell.id,
      expectedUpdatedAt: cell.updatedAt,
      contents: {
        ...contents,
        metricConfig: {
          ...savedConfig,
          ...patch,
          revision: savedConfig.revision + 1,
        },
      },
    });
  }

  const gear = canEdit ? (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("singleValue.label")}
          className="size-7"
        >
          <IconSettings size={16} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby={dialogTitle}
        className="max-w-[calc(100vw-1rem)]"
      >
        <div className="grid gap-3">
          <h3 id={dialogTitle} className="text-sm font-semibold">
            {t("singleValue.label")}
          </h3>
          <MetricSelect
            label={t("singleValue.value")}
            placeholder={t("singleValue.chooseInput")}
            value={selectedSource}
            options={sources.map(({ binding, name }) => ({
              value: sourceKey(binding),
              label: name,
            }))}
            disabled={disabled}
            onChange={(selection) => {
              const next = sources.find(
                ({ binding }) => sourceKey(binding) === selection,
              );
              if (next && selection !== selectedSource) {
                const { cellId, exportId } = next.binding;
                changeConfig({
                  source: { cellId, exportId },
                  fieldId: next.fields[0]?.fieldId ?? null,
                  aggregation: null,
                  mode: "aggregate",
                  row: 0,
                  format: null,
                });
              }
            }}
          />
          <MetricSelect
            label={t("singleValue.column")}
            placeholder={t("singleValue.chooseColumn")}
            value={field?.fieldId}
            options={fields.map(({ fieldId, name }) => ({
              value: fieldId,
              label: name,
            }))}
            disabled={disabled}
            onChange={(fieldId) => {
              const nextField = fields.find(
                (candidate) => candidate.fieldId === fieldId,
              );
              changeConfig({
                fieldId,
                aggregation: null,
                ...(nextField?.type === "string" ? { mode: "aggregate" } : {}),
                format: null,
              });
            }}
          />
          <fieldset
            className="grid min-w-0 gap-1 text-sm"
            disabled={disabled || !field}
          >
            <legend>{t("singleValue.type")}</legend>
            <div className="grid grid-cols-2 gap-1">
              <Button
                type="button"
                size="sm"
                variant={config.mode === "aggregate" ? "secondary" : "outline"}
                aria-pressed={config.mode === "aggregate"}
                onClick={() => changeConfig({ mode: "aggregate" })}
              >
                {t("singleValue.aggregate")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={config.mode === "row" ? "secondary" : "outline"}
                aria-pressed={config.mode === "row"}
                disabled={field?.type === "string"}
                onClick={() => changeConfig({ mode: "row" })}
              >
                {t("singleValue.row")}
              </Button>
            </div>
          </fieldset>
          {config.mode === "aggregate" ? (
            <MetricSelect
              label={t("singleValue.aggregate")}
              value={aggregate ?? undefined}
              options={
                field
                  ? metricAggregations(field).map((value) => ({
                      value,
                      label: t(`singleValue.aggregation.${value}`),
                    }))
                  : []
              }
              disabled={disabled}
              onChange={(aggregation) =>
                changeConfig({ aggregation, format: null })
              }
            />
          ) : (
            <label className="grid gap-1 text-sm">
              {t("singleValue.row")}
              <Input
                key={config.row}
                type="number"
                aria-label={t("singleValue.row")}
                defaultValue={config.row}
                min={rowCount === undefined ? undefined : -rowCount}
                max={
                  rowCount === undefined ? undefined : Math.max(0, rowCount - 1)
                }
                step={1}
                disabled={disabled}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                onBlur={({ currentTarget }) => {
                  const row = currentTarget.valueAsNumber;
                  if (
                    currentTarget.validity.valid &&
                    Number.isSafeInteger(row) &&
                    row !== config.row
                  )
                    changeConfig({ row });
                  else currentTarget.value = String(config.row);
                }}
              />
            </label>
          )}
          <label className="grid gap-1 text-sm">
            {t("singleValue.title")}
            <Input
              key={config.title}
              defaultValue={config.title}
              aria-label={t("singleValue.title")}
              placeholder={t("singleValue.exampleTitle", {
                month: "{{ month }}",
              })}
              disabled={disabled}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              onBlur={({ currentTarget }) => {
                if (currentTarget.value !== config.title)
                  changeConfig({ title: currentTarget.value });
              }}
            />
          </label>
          <MetricSelect
            label={t("singleValue.format")}
            value={effectiveFormat(config, formats)}
            options={formats.map((value) => ({
              value,
              label: t(`singleValue.formats.${value}`),
            }))}
            disabled={disabled || formats.length === 1}
            onChange={(format) => changeConfig({ format })}
          />
          {retry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              {t("editorPreferences.retry")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  ) : null;

  return (
    <div className="p-3">
      <MetricTile
        config={savedConfig}
        namedValues={namedValues}
        result={result}
        pending={savedConfig.source !== null && query.isPending}
        failed={retry}
        notebook
        gear={gear}
      />
      {save.isError && (
        <p role="alert" className="pt-2 text-sm text-destructive">
          {t("singleValue.saveFailed")}
        </p>
      )}
    </div>
  );
}
