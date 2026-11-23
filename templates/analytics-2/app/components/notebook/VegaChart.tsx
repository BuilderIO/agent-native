import { useT } from "@agent-native/core/client/i18n";
import { useReaderLocale } from "@agent-native/toolkit/app/shared/reader-locale";
import { useEffect, useMemo, useRef, useState } from "react";

import { chartBucketFormatter } from "./chart-config";
import {
  ChartDrawing,
  formatChartValue,
  formatDayLabel,
  type ChartDrawingProps,
} from "./ChartDrawing";
import { formatCellValue } from "./utils";
import {
  buildVegaSpec,
  isGanttRangeCell,
  isVegaMark,
  type VegaDatum,
} from "./vega-spec";

import "./notebook.css";

type Embed = typeof import("vega-embed").default;

const TABLEAU_10 = [
  "#4c78a8",
  "#f58518",
  "#e45756",
  "#72b7b2",
  "#54a24b",
  "#eeca3b",
  "#b279a2",
  "#ff9da6",
  "#9d755d",
  "#bab0ac",
] as const;

const DEFAULT_FALLBACK_WIDTH = 480;
const SENTINEL_A = "rgb(1, 2, 3)";
const SENTINEL_B = "rgb(4, 5, 6)";
const INVALID_RESOLVED_COLORS = new Set([
  "",
  "inherit",
  "initial",
  "unset",
  "revert",
  "currentcolor",
  "transparent",
]);

function isValidResolvedColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    !INVALID_RESOLVED_COLORS.has(normalized) && !normalized.includes("var(")
  );
}

function resolvePalette(
  host: HTMLElement,
  entries: ReadonlyArray<{ color: string; fallback: string }>,
): string[] {
  if (entries.length === 0) return [];
  const doc = host.ownerDocument;
  const wrapper = doc.createElement("span");
  wrapper.style.display = "none";
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.style.color = SENTINEL_A;

  const probes = entries.map(({ color, fallback }) => {
    const probe = doc.createElement("span");
    probe.style.color = color;
    const validWrite = Boolean(probe.style.color);
    if (validWrite) wrapper.appendChild(probe);
    return { probe, fallback, validWrite };
  });

  host.appendChild(wrapper);
  try {
    const firstPass = probes.map(({ probe, validWrite }) =>
      validWrite ? getComputedStyle(probe).color : "",
    );

    const ambiguousIndices: number[] = [];
    for (let i = 0; i < firstPass.length; i += 1) {
      if (firstPass[i] === SENTINEL_A) ambiguousIndices.push(i);
    }

    const recheckedMap = new Map<number, string>();
    if (ambiguousIndices.length > 0) {
      wrapper.style.color = SENTINEL_B;
      for (const index of ambiguousIndices) {
        const entry = probes[index];
        if (entry) {
          recheckedMap.set(index, getComputedStyle(entry.probe).color);
        }
      }
    }

    return probes.map(({ fallback, validWrite }, index) => {
      if (!validWrite) return fallback;
      const resolved = firstPass[index] ?? "";
      if (!isValidResolvedColor(resolved)) return fallback;
      if (resolved === SENTINEL_A) {
        const rechecked = recheckedMap.get(index) ?? "";
        if (rechecked === SENTINEL_B || !isValidResolvedColor(rechecked)) {
          return fallback;
        }
        return rechecked;
      }
      return resolved;
    });
  } finally {
    wrapper.remove();
  }
}

function resolveEmbedWidth(
  host: HTMLElement,
  spec: Record<string, any>,
): Record<string, any> {
  if (spec.width === "container" && host.clientWidth === 0) {
    return { ...spec, width: DEFAULT_FALLBACK_WIDTH };
  }
  return spec;
}

function observeResize(
  host: HTMLElement,
  view: {
    width?: (w: number) => unknown;
    resize?: () => { runAsync?: () => Promise<unknown> };
  },
  isContainerWidth: boolean,
): () => void {
  if (!isContainerWidth || typeof ResizeObserver === "undefined") {
    return () => {};
  }
  let lastWidth = host.clientWidth;
  const observer = new ResizeObserver((entries) => {
    const measured = Math.floor(
      entries[0]?.contentRect?.width ?? host.clientWidth,
    );
    if (measured <= 0 || measured === lastWidth) return;
    lastWidth = measured;
    view.width?.(measured);
    void view.resize?.().runAsync?.();
  });
  observer.observe(host);
  return () => observer.disconnect();
}

async function embedInto(
  host: HTMLElement,
  spec: Record<string, any>,
): ReturnType<Embed> {
  const mod = (await import("vega-embed")) as {
    default?: Embed | { default?: Embed };
  };
  const embed = (
    typeof mod.default === "function"
      ? mod.default
      : typeof mod.default?.default === "function"
        ? mod.default.default
        : mod
  ) as Embed;
  const mode =
    typeof spec.$schema === "string" && spec.$schema.includes("/schema/vega/")
      ? "vega"
      : "vega-lite";
  const dark =
    host.ownerDocument?.documentElement?.classList.contains("dark") ?? false;
  return embed(host, resolveEmbedWidth(host, spec) as never, {
    actions: false,
    renderer: "svg",
    mode,
    tooltip: { theme: dark ? "dark" : "light" },
  });
}

function isPlottableForMark(props: ChartDrawingProps): boolean {
  const { mark, columns, rows, points } = props;
  if (mark === "histogram") {
    if (columns.length < 1) return false;
    return points != null
      ? points.length > 0
      : rows.some((row) => row.some((v) => typeof v === "number"));
  }
  if (mark === "gantt") {
    if (columns.length < 3) return false;
    return rows.some(
      (row) => isGanttRangeCell(row[1]) && isGanttRangeCell(row[2]),
    );
  }
  if (columns.length < 2) return false;
  return points != null
    ? points.length > 0
    : rows.some((row) => row.slice(1).some((v) => typeof v === "number"));
}

function extractBinRange(
  picked: Record<string, unknown> | null,
): [number, number] | null {
  if (!picked) return null;
  for (const [key, val] of Object.entries(picked)) {
    if (!key.includes("rawX") || !Array.isArray(val) || val.length === 0) {
      continue;
    }
    const first = val[0];
    if (
      Array.isArray(first) &&
      typeof first[0] === "number" &&
      typeof first[1] === "number"
    ) {
      return [first[0], first[1]];
    }
    if (typeof val[0] === "number" && typeof val[1] === "number") {
      return [val[0], val[1]];
    }
    if (typeof first === "number") {
      return [first, first];
    }
  }
  return null;
}

export function VegaChart(props: ChartDrawingProps) {
  const { mark, funnelOutcomes } = props;
  if (
    !isVegaMark(mark) ||
    (mark === "funnel" && funnelOutcomes) ||
    !isPlottableForMark(props)
  ) {
    return <ChartDrawing {...props} />;
  }
  return <VegaChartView {...props} />;
}

function VegaChartView({
  columns,
  rows,
  mark,
  orientation,
  stackMode,
  binCount,
  encoding,
  stacked,
  colors,
  yFormatter,
  seriesLabels,
  legend,
  tooltipChannels,
  onMarkClick,
  points,
  onMarkSelect,
  title,
  height = 260,
  loading = false,
}: ChartDrawingProps) {
  const t = useT();
  const locale = useReaderLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const timeUnit = encoding?.timeUnit;
  const latest = useRef({
    mark,
    onMarkClick,
    onMarkSelect,
    points,
    rows,
    columns,
    timeUnit,
  });
  latest.current = {
    mark,
    onMarkClick,
    onMarkSelect,
    points,
    rows,
    columns,
    timeUnit,
  };
  const colorIndices = encoding?.colorIndices;
  const colorKey = JSON.stringify(colors ?? null);
  const colorIndexKey = JSON.stringify(colorIndices ?? null);
  const hasEncoding = encoding != null;

  const build = (palette: readonly string[]) => {
    const dateFormatter =
      timeUnit == null ? null : chartBucketFormatter(timeUnit, locale, t);
    return buildVegaSpec({
      columns,
      rows,
      mark,
      orientation,
      stackMode,
      binCount,
      palette,
      stacked,
      legend,
      tooltipChannels,
      title,
      height,
      seriesLabels,
      points,
      formatCategory: (value, rowIndex) => {
        if (dateFormatter && typeof value === "number")
          return dateFormatter(value);
        const text = formatCellValue(value);
        if (text === "") return String(rowIndex + 1);
        if (seriesLabels && Object.hasOwn(seriesLabels, text))
          return seriesLabels[text] ?? text;
        return formatDayLabel(text, locale) ?? text;
      },
      formatValue: (value) => formatChartValue(value, yFormatter, locale),
      valueFormat: yFormatter,
    });
  };
  const buildRef = useRef(build);
  buildRef.current = build;

  const paletteFor = useMemo(
    () => (host: HTMLElement) => {
      const count = Math.max(columns.length - 1, rows.length, 10);
      const entries = Array.from({ length: count }, (_, index) => {
        if (!hasEncoding) {
          return {
            color: colors?.[index] ?? `hsl(var(--chart-${(index % 5) + 1}))`,
            fallback: TABLEAU_10[index % TABLEAU_10.length]!,
          };
        }
        const colorIndex = colorIndices?.[index] ?? index;
        return {
          color:
            colors?.[colorIndex] ??
            `var(--nb-tableau-${(colorIndex % 10) + 1})`,
          fallback: TABLEAU_10[colorIndex % TABLEAU_10.length]!,
        };
      });
      return resolvePalette(host, entries);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorKey, colorIndexKey, hasEncoding, columns.length, rows.length],
  );

  const specKey = JSON.stringify(
    build(Array.from({ length: 10 }, (_, i) => String(i))),
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let finalize: (() => void) | undefined;
    setRenderError(null);
    const spec = buildRef.current(paletteFor(host));
    const isContainerWidth = spec.width === "container";
    void embedInto(host, spec)
      .then((result) => {
        if (cancelled) {
          result.finalize();
          return;
        }
        const disconnectResize = observeResize(
          host,
          result.view,
          isContainerWidth,
        );
        finalize = () => {
          disconnectResize();
          result.finalize();
        };
        const data = (spec.data?.values ?? []) as VegaDatum[];
        const handlePick = (_name: string, value: unknown) => {
          const picked = value as Record<string, unknown> | null;
          const {
            mark: currentMark,
            onMarkSelect: select,
            onMarkClick: click,
            points: currentPoints,
            rows: currentRows,
            columns: currentColumns,
            timeUnit: currentTimeUnit,
          } = latest.current;

          if (currentMark === "histogram") {
            const range = extractBinRange(picked);
            if (!range) return;
            const [binStart, binEnd] = range;
            const maxX = data.reduce(
              (max, d) => (d.rawX != null && d.rawX > max ? d.rawX : max),
              -Infinity,
            );
            const isFinalBin = binEnd >= maxX;
            const datum =
              data.find(
                (d) =>
                  d.rawX != null &&
                  d.rawX >= binStart &&
                  (isFinalBin ? d.rawX <= binEnd : d.rawX < binEnd),
              ) ?? data[0];
            if (!datum) return;
            if (select) {
              const matchedPoint = currentPoints?.find(
                (point) =>
                  point.rowIndex === datum.rowIndex &&
                  point.seriesIndex === datum.seriesIndex,
              );
              const svg = host.querySelector("svg");
              if (svg)
                select(matchedPoint ?? datum, svg as unknown as SVGElement);
              return;
            }
            click?.({
              x: `${binStart}–${binEnd}`,
              series: datum.series || currentColumns[0] || "",
            });
            return;
          }

          const xArr = picked?.x as unknown[] | undefined;
          const seriesArr = picked?.series as unknown[] | undefined;
          const x = xArr?.[0];
          const series = seriesArr?.[0];
          if (x == null) return;
          const datum = data.find(
            (d) => d.x === x && (series === undefined || d.series === series),
          );
          if (!datum) return;
          if (select) {
            const matchedPoint = currentPoints?.find(
              (point) =>
                point.rowIndex === datum.rowIndex &&
                point.seriesIndex === datum.seriesIndex,
            );
            const svg = host.querySelector("svg");
            if (svg)
              select(matchedPoint ?? datum, svg as unknown as SVGElement);
            return;
          }
          if (currentMark === "gantt") {
            const raw = currentRows[datum.rowIndex]?.[0];
            const rawSeries =
              currentColumns.length >= 4
                ? currentRows[datum.rowIndex]?.[3]
                : datum.series;
            click?.({
              x: String(raw ?? datum.x),
              series: String(rawSeries ?? datum.series),
            });
            return;
          }
          const raw = currentRows[datum.rowIndex]?.[0];
          click?.({
            x:
              currentTimeUnit != null && typeof raw === "number"
                ? new Date(raw).toISOString()
                : String(raw ?? ""),
            series: currentColumns[datum.seriesIndex + 1] ?? datum.series ?? "",
          });
        };
        result.view.addSignalListener("pick", handlePick);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("[VegaChart] failed to embed chart", { mark, error });
          host.textContent = "";
          setRenderError(
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    return () => {
      cancelled = true;
      finalize?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, paletteFor]);

  return (
    <>
      <div
        ref={hostRef}
        className={`nb-vega-chart nb-chart-mark-${mark}${loading ? " is-loading" : ""}`}
        aria-busy={loading || undefined}
        data-chart-mark-type={mark}
        hidden={renderError != null}
      />
      {renderError != null ? (
        <div
          className="nb-output-error"
          role="alert"
          data-chart-error="render-failed"
        >
          <strong>
            {t("notebook.chartRenderFailed", {
              defaultValue: "This chart could not be drawn.",
            })}
          </strong>
          <pre>{renderError}</pre>
        </div>
      ) : null}
    </>
  );
}

export function VegaSpecChart({ spec }: { spec: Record<string, unknown> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const specKey = JSON.stringify(spec);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let finalize: (() => void) | undefined;
    const mergedSpec: Record<string, unknown> = {
      width: "container",
      background: "transparent",
      ...spec,
      config: {
        view: { stroke: null },
        axis: { labelColor: "currentColor", domainColor: "currentColor" },
        legend: { labelColor: "currentColor", titleColor: "currentColor" },
        ...(spec.config as object | undefined),
      },
    };
    const isContainerWidth = mergedSpec.width === "container";
    void embedInto(host, mergedSpec)
      .then((result) => {
        if (cancelled) {
          result.finalize();
          return;
        }
        const disconnectResize = observeResize(
          host,
          result.view,
          isContainerWidth,
        );
        finalize = () => {
          disconnectResize();
          result.finalize();
        };
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("[VegaSpecChart] failed to embed chart", error);
          host.textContent = String(error);
        }
      });
    return () => {
      cancelled = true;
      finalize?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);
  return <div ref={hostRef} className="nb-vega-chart" />;
}
