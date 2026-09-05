import { useT } from "@agent-native/core/client/i18n";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  Label,
  PolarAngleAxis,
  PolarRadiusAxis,
  RadialBar,
  RadialBarChart,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

const TOOLTIP_GAP = 10;
const TOOLTIP_FALLBACK_WIDTH = 144;
const TOOLTIP_FALLBACK_HEIGHT = 32;

function CursorChartTooltip({
  containerRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const contentRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [position, setPosition] = useState<
    { x: number; y: number } | undefined
  >();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updatePosition = (event: PointerEvent) => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = window.requestAnimationFrame(() => {
        const bounds = container.getBoundingClientRect();
        const cursorX = event.clientX - bounds.left;
        const cursorY = event.clientY - bounds.top;
        const tooltipWidth =
          contentRef.current?.offsetWidth ?? TOOLTIP_FALLBACK_WIDTH;
        const tooltipHeight =
          contentRef.current?.offsetHeight ?? TOOLTIP_FALLBACK_HEIGHT;
        const x = Math.min(
          Math.max(cursorX - tooltipWidth / 2, 0),
          bounds.width - tooltipWidth,
        );
        const belowCursor = cursorY + TOOLTIP_GAP;
        const y =
          belowCursor + tooltipHeight <= bounds.height
            ? belowCursor
            : cursorY - tooltipHeight - TOOLTIP_GAP;

        setPosition({ x: Math.max(0, x), y: Math.max(0, y) });
        frameRef.current = null;
      });
    };
    const clearPosition = () => setPosition(undefined);

    container.addEventListener("pointermove", updatePosition);
    container.addEventListener("pointerleave", clearPosition);
    return () => {
      container.removeEventListener("pointermove", updatePosition);
      container.removeEventListener("pointerleave", clearPosition);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [containerRef]);

  return (
    <ChartTooltip
      cursor={false}
      isAnimationActive={false}
      position={position}
      content={
        <ChartTooltipContent
          ref={contentRef}
          hideLabel
          hideIndicator
          className="w-36 shadow-md"
          formatter={(value, _name, item) => (
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <span className="truncate text-muted-foreground">
                {String(item?.payload?.label ?? "")}
              </span>
              <span className="shrink-0 font-mono font-medium tabular-nums text-foreground">
                {Math.round(Number(value))}%
              </span>
            </div>
          )}
        />
      }
    />
  );
}

export interface InsightsChartProps {
  views: number;
  uniqueViewers: number;
  reactions?: number;
  completionRate: number | null;
  ctaConversionRate: number | null;
}

export function InsightsChart({
  views,
  uniqueViewers,
  reactions = 0,
  completionRate,
  ctaConversionRate,
}: InsightsChartProps) {
  const t = useT();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const safeViews = Math.max(0, views);
  const safeUniqueViewers = Math.max(0, uniqueViewers);
  const safeReactions = Math.max(0, reactions);
  const completion = clampRate(completionRate);
  const ctaConversion = clampRate(ctaConversionRate);
  const rateData = [
    {
      metric: "completion",
      label: t("recordingInsights.completion"),
      value: completion,
      fill: "var(--color-completion)",
    },
    {
      metric: "ctaConversion",
      label: t("recordingInsights.ctaConversion"),
      value: ctaConversion,
      fill: "var(--color-ctaConversion)",
    },
  ];
  const chartConfig = {
    completion: {
      label: t("recordingInsights.completion"),
      color: "hsl(var(--highlight))",
    },
    ctaConversion: {
      label: t("recordingInsights.ctaConversion"),
      color: "hsl(var(--muted-foreground))",
    },
  } satisfies ChartConfig;

  return (
    <section aria-label={t("insightsHub.title")}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,0.78fr)] items-center gap-3">
        <ChartContainer
          ref={chartContainerRef}
          config={chartConfig}
          aria-label={t("recordingInsights.averageCompletionRate")}
          className="mx-auto aspect-square h-[220px] w-full max-w-[220px]"
        >
          <RadialBarChart
            accessibilityLayer
            data={rateData}
            startAngle={90}
            endAngle={-270}
            innerRadius="48%"
            outerRadius="92%"
            barSize={13}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
              <Label
                content={({ viewBox }) => {
                  if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) {
                    return null;
                  }

                  return (
                    <text
                      x={viewBox.cx}
                      y={viewBox.cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      <tspan
                        x={viewBox.cx}
                        y={viewBox.cy}
                        className="fill-foreground text-3xl font-semibold tabular-nums"
                      >
                        {safeViews.toLocaleString()}
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy ?? 0) + 22}
                        className="fill-muted-foreground text-[11px]"
                      >
                        {t("recordingInsights.views")}
                      </tspan>
                    </text>
                  );
                }}
              />
            </PolarRadiusAxis>
            <CursorChartTooltip containerRef={chartContainerRef} />
            <RadialBar
              dataKey="value"
              background
              cornerRadius={999}
              animationBegin={0}
              animationDuration={600}
              animationEasing="ease-out"
              isAnimationActive="auto"
            />
          </RadialBarChart>
        </ChartContainer>

        <dl className="grid min-w-0 gap-4">
          <RateMetric
            label={t("recordingInsights.completion")}
            value={formatRate(completionRate)}
            indicatorClassName="bg-highlight"
          />
          <RateMetric
            label={t("recordingInsights.ctaConversion")}
            value={formatRate(ctaConversionRate)}
            indicatorClassName="bg-muted-foreground"
          />
          <div className="grid grid-cols-2 gap-3 border-t border-border/70 pt-4">
            <CountMetric
              label={t("recordingInsights.uniqueViewers")}
              value={safeUniqueViewers}
            />
            <CountMetric
              label={t("insightsHub.reactions")}
              value={safeReactions}
            />
          </div>
        </dl>
      </div>
    </section>
  );
}

function RateMetric({
  label,
  value,
  indicatorClassName,
}: {
  label: string;
  value: string;
  indicatorClassName: string;
}) {
  return (
    <div className="relative ps-5">
      <span
        aria-hidden="true"
        className={cn(
          "absolute start-0 top-1 h-8 w-1 rounded-full",
          indicatorClassName,
        )}
      />
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

function CountMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] leading-4 text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function clampRate(value: number | null): number {
  return Math.min(100, Math.max(0, value ?? 0));
}

function formatRate(value: number | null): string {
  return `${Math.round(clampRate(value))}%`;
}
