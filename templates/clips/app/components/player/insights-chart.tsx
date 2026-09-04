import { useT } from "@agent-native/core/client/i18n";
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
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value, _name, item) => [
                    `${Math.round(Number(value))}%`,
                    String(item?.payload?.label ?? ""),
                  ]}
                />
              }
            />
            <RadialBar
              dataKey="value"
              background
              cornerRadius={999}
              isAnimationActive={false}
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
