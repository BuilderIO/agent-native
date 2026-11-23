import { useT } from "@agent-native/core/client/i18n";

import type { ChartSpec } from "@/lib/model/contracts";

import { formatCellValue } from "./utils";

type CellValue = string | number | boolean | null;
function countValue(value: CellValue | undefined): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function optionalValue(value: CellValue | undefined): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  if (typeof value === "string") {
    const flag = value.trim().toLowerCase();
    if (flag === "true" || flag === "1") return true;
    if (flag === "false" || flag === "0") return false;
  }
  return null;
}
export function FunnelOutcomes({
  columns,
  rows,
  binding,
  colors,
  seriesLabels,
  onMarkClick,
}: {
  columns: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<CellValue>>;
  binding: NonNullable<ChartSpec["funnelOutcomes"]>;
  colors?: readonly string[] | undefined;
  seriesLabels?: Record<string, string> | undefined;
  onMarkClick?: ((mark: { x: string; series: string }) => void) | undefined;
}) {
  const t = useT();
  const doneIndex = columns.indexOf(binding.completedKey);
  const leftIndex = columns.indexOf(binding.leftKey);
  const skipIndex = binding.skippedKey
    ? columns.indexOf(binding.skippedKey)
    : -1;
  const optionalIndex = binding.optionalKey
    ? columns.indexOf(binding.optionalKey)
    : -1;
  const parsed = rows.map((row) => {
    const shown = countValue(row[1]);
    const done = countValue(row[doneIndex]);
    const left = countValue(row[leftIndex]);
    const skipped = binding.skippedKey ? countValue(row[skipIndex]) : 0;
    const optional = binding.optionalKey
      ? optionalValue(row[optionalIndex])
      : false;
    if (
      doneIndex < 0 ||
      leftIndex < 0 ||
      (binding.skippedKey && skipIndex < 0) ||
      (binding.optionalKey && optionalIndex < 0) ||
      shown === null ||
      done === null ||
      left === null ||
      skipped === null ||
      optional === null ||
      done + skipped + left > shown
    )
      return null;
    return {
      shown,
      values: [done, skipped, shown - done - skipped - left, left],
      optional,
    };
  });
  if (
    columns[0] === "" ||
    columns[1] === "" ||
    parsed.some((row) => row === null)
  )
    return (
      <div className="nb-side-panel-error" role="alert">
        {t("funnel.invalid")}
      </div>
    );
  const labels = [
    t("funnel.completed"),
    t("funnel.skipped"),
    t("funnel.movedOn"),
    t("funnel.left"),
  ];
  const fields = [
    binding.completedKey,
    binding.skippedKey ?? columns[1] ?? "",
    columns[1] ?? "",
    binding.leftKey,
  ];
  return (
    <div className="nb-output nb-chart" style={{ display: "grid", gap: 12 }}>
      {parsed.map((stage, index) => {
        if (!stage) return null;
        const raw = rows[index]?.[0] ?? null;
        const name = formatCellValue(raw);
        const displayed =
          seriesLabels && Object.hasOwn(seriesLabels, name)
            ? seriesLabels[name]
            : name;
        return (
          <div key={index}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>
                {displayed}{" "}
                {stage.optional ? <span>{t("funnel.optional")}</span> : null}
              </span>
              <span>
                {stage.shown} ·{" "}
                {(stage.shown
                  ? ((stage.values[3] ?? 0) / stage.shown) * 100
                  : 0
                ).toFixed(1)}
                %
              </span>
            </div>
            <div style={{ display: "flex", height: 24 }}>
              {stage.values.map((value, segment) => (
                <button
                  key={segment}
                  type="button"
                  disabled={!onMarkClick}
                  onClick={() =>
                    onMarkClick?.({
                      x: String(raw ?? ""),
                      series: fields[segment] ?? "",
                    })
                  }
                  title={`${labels[segment]}: ${value}`}
                  aria-label={`${labels[segment]}: ${value}`}
                  style={{
                    width: `${stage.shown ? (value / stage.shown) * 100 : 0}%`,
                    minWidth: 0,
                    padding: 0,
                    border: 0,
                    background:
                      colors?.[segment] ?? `hsl(var(--chart-${segment + 1}))`,
                  }}
                />
              ))}
            </div>
            <div>
              {stage.values.map((value, segment) => (
                <span key={segment} style={{ marginInlineEnd: 12 }}>
                  {labels[segment]}: {value}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <div>
        {labels.map((label, index) =>
          index === 1 && !binding.skippedKey ? null : (
            <span
              key={label}
              style={{
                color: colors?.[index] ?? `hsl(var(--chart-${index + 1}))`,
                marginInlineEnd: 12,
              }}
            >
              ● {label}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
