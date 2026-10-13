import { useT } from "@agent-native/core/client/i18n";
import {
  DATA_CHART_WIDGET,
  DATA_INSIGHTS_WIDGET,
  DATA_TABLE_WIDGET,
  type DataTableColumn,
  type DataWidgetResult,
} from "@agent-native/core/data-widgets";
import { Text, View } from "react-native";

import { getNativeInteractivePreview } from "@/lib/agent-chat/native-interactive-preview";
import type { ChatContentPart } from "@/lib/agent-chat/types";

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function DataRows({
  columns,
  rows,
}: {
  columns: DataTableColumn[];
  rows: Array<Record<string, unknown>>;
}) {
  if (!columns.length || !rows.length) return null;
  return (
    <View className="gap-2">
      {rows.map((row, rowIndex) => (
        <View
          key={rowIndex}
          className="gap-1.5 border-t border-border-dark pt-2"
        >
          {columns.map((column) => (
            <View key={column.key} className="flex-row items-start gap-3">
              <Text
                className="w-24 shrink-0 text-text-muted text-[12px] leading-4"
                numberOfLines={1}
              >
                {column.label}
              </Text>
              <Text className="flex-1 text-foreground text-[13px] leading-4">
                {displayValue(row[column.key])}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function DataWidgetContent({ result }: { result: DataWidgetResult }) {
  if (result.widget === DATA_TABLE_WIDGET) {
    return <DataRows columns={result.table.columns} rows={result.table.rows} />;
  }

  const chart =
    result.widget === DATA_CHART_WIDGET
      ? result.chartSeries
      : result.widget === DATA_INSIGHTS_WIDGET
        ? result.chartSeries
        : undefined;
  const table =
    result.widget === DATA_INSIGHTS_WIDGET ? result.table : undefined;
  const chartColumns: DataTableColumn[] = chart
    ? [
        { key: chart.xKey, label: chart.xKey },
        ...chart.series.map((series) => ({
          key: series.key,
          label: series.label,
          align: "right" as const,
        })),
      ]
    : [];
  const summary = Object.entries(result.summary ?? {}).filter(
    ([, value]) =>
      value === null || ["string", "number", "boolean"].includes(typeof value),
  );

  return (
    <View className="gap-3">
      {summary.length ? (
        <View className="gap-1.5">
          {summary.map(([label, value]) => (
            <View key={label} className="flex-row items-start gap-3">
              <Text
                className="w-24 shrink-0 text-text-muted text-[12px] leading-4"
                numberOfLines={1}
              >
                {label}
              </Text>
              <Text className="flex-1 text-foreground text-[13px] leading-4">
                {displayValue(value)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {chart ? <DataRows columns={chartColumns} rows={chart.data} /> : null}
      {table ? <DataRows columns={table.columns} rows={table.rows} /> : null}
    </View>
  );
}

export function NativeInteractiveResult({
  part,
}: {
  part: Extract<ChatContentPart, { type: "tool-call" }>;
}) {
  const t = useT();
  const preview = getNativeInteractivePreview(part);
  const title = preview.title ?? t("message.mobileInteractiveTitle");

  return (
    <View className="mx-0.5 rounded-2xl border border-border-dark bg-card-dark p-4 gap-2">
      <Text className="text-foreground text-[14px] font-semibold">{title}</Text>
      {preview.kind === "data" ? (
        <DataWidgetContent result={preview.result} />
      ) : (
        <>
          {preview.kind === "text" && preview.description ? (
            <Text className="text-text-muted text-[13px] leading-5">
              {preview.description}
            </Text>
          ) : null}
          {preview.kind === "text"
            ? preview.text.map((text, index) => (
                <Text
                  key={`${index}-${text.slice(0, 24)}`}
                  className="text-foreground text-[13px] leading-5"
                >
                  {text}
                </Text>
              ))
            : null}
          <Text className="text-text-muted text-[13px] leading-5">
            {t("message.mobileInteractiveDescription")}
          </Text>
        </>
      )}
    </View>
  );
}
