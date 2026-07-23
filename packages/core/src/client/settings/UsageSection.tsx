import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { agentNativePath } from "../api-path.js";

interface UsageBucket {
  key: string;
  cents: number;
  cost: UsageCostAggregate;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface DailyBucket {
  date: string;
  cents: number;
  cost: UsageCostAggregate;
  calls: number;
}

interface UsageRecentEntry {
  id: number;
  createdAt: number;
  label: string;
  app: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cents: number;
  costSource: "reported" | "estimated" | "unavailable";
}

type UsageCostAggregate =
  | { status: "known"; knownCents: number; unavailableCalls: 0 }
  | { status: "partial"; knownCents: number; unavailableCalls: number }
  | { status: "unavailable"; knownCents: 0; unavailableCalls: number };

interface UsageBillingMode {
  unit: "usd" | "builder-credits";
  label: string;
  shortLabel: string;
  source: "estimated-provider-cost" | "builder-agent-credits";
  hardCostMarginMultiplier?: number;
  creditsPerUsd?: number;
}

interface UsageSummary {
  billing?: UsageBillingMode;
  totalCents: number;
  totalCost: UsageCostAggregate;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  sinceMs: number;
  byLabel: UsageBucket[];
  byModel: UsageBucket[];
  byApp: UsageBucket[];
  byDay: DailyBucket[];
  recent: UsageRecentEntry[];
}

const RANGES = [
  { value: 1, label: "24h" },
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
];

const USD_BILLING: UsageBillingMode = {
  unit: "usd",
  label: "Estimated spend",
  shortLabel: "Cost",
  source: "estimated-provider-cost",
};

function displayAmountFromCostCents(
  cents: number,
  billing: UsageBillingMode,
): number {
  if (billing.unit !== "builder-credits") return cents;
  const margin = billing.hardCostMarginMultiplier ?? 1.25;
  const creditsPerUsd = billing.creditsPerUsd ?? 20;
  const credits = (cents / 100) * margin * creditsPerUsd;
  return credits <= 0 ? 0 : Math.ceil(credits * 1000) / 1000;
}

function formatCredits(credits: number): string {
  if (!Number.isFinite(credits) || credits === 0) return "0 credits";
  const maximumFractionDigits = credits < 1 ? 3 : credits < 10 ? 2 : 1;
  const value = credits.toLocaleString(undefined, {
    maximumFractionDigits,
  });
  return `${value} ${credits === 1 ? "credit" : "credits"}`;
}

function formatSpend(cents: number, billing: UsageBillingMode): string {
  if (billing.unit === "builder-credits") {
    return formatCredits(displayAmountFromCostCents(cents, billing));
  }
  // Sub-cent values (e.g. a single LLM call at $0.0045 = 0.45¢) — keep
  // three decimals so tiny calls don't round to 0.00¢. The prior impl
  // multiplied by 100 in this branch, overstating small costs 100×.
  if (cents < 1) return `${cents.toFixed(3)}¢`;
  if (cents < 100) return `${cents.toFixed(2)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatAggregateCost(
  cost: UsageCostAggregate,
  billing: UsageBillingMode,
): string {
  if (cost.status === "known") return formatSpend(cost.knownCents, billing);
  if (cost.status === "unavailable") return "Unknown";
  return `${formatSpend(cost.knownCents, billing)} + ${cost.unavailableCalls} unpriced`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function BucketBars({
  buckets,
  emptyMessage,
  billing,
}: {
  buckets: UsageBucket[];
  emptyMessage: string;
  billing: UsageBillingMode;
}) {
  if (buckets.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground py-1.5">{emptyMessage}</p>
    );
  }
  const max = Math.max(
    ...buckets.map((b) => displayAmountFromCostCents(b.cents, billing)),
    0.0001,
  );
  return (
    <div className="space-y-1">
      {buckets.map((b) => (
        <div key={b.key} className="text-[10px]">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span
              className="truncate text-foreground"
              title={b.key || "(none)"}
            >
              {b.key || "(none)"}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatAggregateCost(b.cost, billing)}
              <span className="ms-1 opacity-60">
                · {formatTokens(b.inputTokens + b.outputTokens)} tok
              </span>
            </span>
          </div>
          <div className="h-1 rounded-full bg-accent/40 overflow-hidden">
            <div
              className="h-full bg-foreground/70"
              style={{
                width: `${(displayAmountFromCostCents(b.cents, billing) / max) * 100}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DailySparkline({
  days,
  billing,
}: {
  days: DailyBucket[];
  billing: UsageBillingMode;
}) {
  if (days.length === 0) return null;
  const max = Math.max(
    ...days.map((d) => displayAmountFromCostCents(d.cents, billing)),
    0.0001,
  );
  return (
    <div className="flex items-end gap-[2px] h-8 pt-2">
      {days.map((d) => (
        <div
          key={d.date}
          className="flex-1 bg-foreground/60 rounded-sm min-h-[1px]"
          style={{
            height: `${Math.max(
              2,
              (displayAmountFromCostCents(d.cents, billing) / max) * 100,
            )}%`,
          }}
          title={`${d.date}: ${formatAggregateCost(d.cost, billing)} (${d.calls} calls)`}
        />
      ))}
    </div>
  );
}

export function UsageSection() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const billing = data?.billing ?? USD_BILLING;

  const load = async (rangeDays: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        agentNativePath(`/_agent-native/usage?sinceDays=${rangeDays}`),
      );
      if (!res.ok) {
        throw new Error(`Failed (${res.status})`);
      }
      const json = (await res.json()) as UsageSummary;
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load usage");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(days);
  }, [days]);

  return (
    <div className="space-y-3">
      {/* Range selector + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setDays(r.value)}
              className={`px-2 py-0.5 text-[10px] rounded ${
                days === r.value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => load(days)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          disabled={loading}
        >
          {loading ? (
            <IconLoader2 size={11} className="animate-spin" />
          ) : (
            <IconRefresh size={11} />
          )}
        </button>
      </div>

      {error && <p className="text-[10px] text-red-500">{error}</p>}

      {data && (
        <>
          {/* Totals */}
          <div className="rounded-md border border-border px-2.5 py-2">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-[10px] text-muted-foreground">
                  {billing.unit === "builder-credits"
                    ? "Builder.io credit spend"
                    : "Total spend"}
                </div>
                <div className="text-[18px] font-semibold tabular-nums">
                  {formatAggregateCost(data.totalCost, billing)}
                </div>
              </div>
              <div className="text-end">
                <div className="text-[10px] text-muted-foreground">
                  {data.totalCalls} calls
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {formatTokens(data.totalInputTokens)} in ·{" "}
                  {formatTokens(data.totalOutputTokens)} out
                </div>
                {data.totalCacheReadTokens > 0 && (
                  <div className="text-[10px] text-green-500/80">
                    {formatTokens(data.totalCacheReadTokens)} cached
                  </div>
                )}
              </div>
            </div>
            <DailySparkline days={data.byDay} billing={billing} />
          </div>

          {/* By label */}
          <div>
            <div className="text-[10px] font-medium text-foreground mb-1">
              By label
            </div>
            <BucketBars
              buckets={data.byLabel}
              emptyMessage="No labeled calls yet."
              billing={billing}
            />
          </div>

          {/* By model */}
          <div>
            <div className="text-[10px] font-medium text-foreground mb-1">
              By model
            </div>
            <BucketBars
              buckets={data.byModel}
              emptyMessage="No calls recorded."
              billing={billing}
            />
          </div>

          {/* By app — only show when multiple apps contribute */}
          {data.byApp.filter((b) => b.key).length > 1 && (
            <div>
              <div className="text-[10px] font-medium text-foreground mb-1">
                By app
              </div>
              <BucketBars
                buckets={data.byApp}
                emptyMessage=""
                billing={billing}
              />
            </div>
          )}

          {/* Recent calls */}
          {data.recent.length > 0 && (
            <details>
              <summary className="text-[10px] font-medium text-foreground cursor-pointer select-none hover:text-foreground/80">
                Recent calls ({data.recent.length})
              </summary>
              <div className="mt-1.5 max-h-48 overflow-y-auto space-y-0.5 rounded border border-border">
                {data.recent.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] border-b border-border last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-foreground" title={r.label}>
                        {r.label}
                        {r.app ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · {r.app}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString()} · {r.model}
                      </div>
                    </div>
                    <div className="shrink-0 text-end tabular-nums text-muted-foreground">
                      {r.costSource === "unavailable"
                        ? "Unknown"
                        : formatSpend(r.cents, billing)}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {billing.unit === "builder-credits" ? (
            <p className="text-[10px] text-muted-foreground">
              Builder.io credits are estimated from hard token cost, a{" "}
              {billing.hardCostMarginMultiplier ?? 1.25}x margin, and{" "}
              {billing.creditsPerUsd ?? 20} credits per dollar.
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Spend is estimated from published Anthropic pricing and your own
              recorded token counts. Cached input is priced at ~10% of regular
              input. Calls without provider pricing are marked unknown and
              excluded from known-cost subtotals.
            </p>
          )}
        </>
      )}
    </div>
  );
}
