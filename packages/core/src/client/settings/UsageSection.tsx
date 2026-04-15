import { useEffect, useState } from "react";
import { IconLoader2, IconRefresh } from "@tabler/icons-react";

interface UsageBucket {
  key: string;
  cents: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface DailyBucket {
  date: string;
  cents: number;
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
}

interface UsageSummary {
  totalCents: number;
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

function formatCost(cents: number): string {
  if (cents < 1) return `${(cents * 100).toFixed(2)}¢`;
  if (cents < 100) return `${cents.toFixed(2)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function BucketBars({
  buckets,
  emptyMessage,
}: {
  buckets: UsageBucket[];
  emptyMessage: string;
}) {
  if (buckets.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground py-1.5">{emptyMessage}</p>
    );
  }
  const max = Math.max(...buckets.map((b) => b.cents), 0.0001);
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
              {formatCost(b.cents)}
              <span className="ml-1 opacity-60">
                · {formatTokens(b.inputTokens + b.outputTokens)} tok
              </span>
            </span>
          </div>
          <div className="h-1 rounded-full bg-accent/40 overflow-hidden">
            <div
              className="h-full bg-foreground/70"
              style={{ width: `${(b.cents / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DailySparkline({ days }: { days: DailyBucket[] }) {
  if (days.length === 0) return null;
  const max = Math.max(...days.map((d) => d.cents), 0.0001);
  return (
    <div className="flex items-end gap-[2px] h-8 pt-2">
      {days.map((d) => (
        <div
          key={d.date}
          className="flex-1 bg-foreground/60 rounded-sm min-h-[1px]"
          style={{ height: `${Math.max(2, (d.cents / max) * 100)}%` }}
          title={`${d.date}: ${formatCost(d.cents)} (${d.calls} calls)`}
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

  const load = async (rangeDays: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/_agent-native/usage?sinceDays=${rangeDays}`);
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
                  Total spend
                </div>
                <div className="text-[18px] font-semibold tabular-nums">
                  {formatCost(data.totalCents)}
                </div>
              </div>
              <div className="text-right">
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
            <DailySparkline days={data.byDay} />
          </div>

          {/* By label */}
          <div>
            <div className="text-[10px] font-medium text-foreground mb-1">
              By label
            </div>
            <BucketBars
              buckets={data.byLabel}
              emptyMessage="No labeled calls yet."
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
            />
          </div>

          {/* By app — only show when multiple apps contribute */}
          {data.byApp.filter((b) => b.key).length > 1 && (
            <div>
              <div className="text-[10px] font-medium text-foreground mb-1">
                By app
              </div>
              <BucketBars buckets={data.byApp} emptyMessage="" />
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
                    <div className="shrink-0 text-right tabular-nums text-muted-foreground">
                      {formatCost(r.cents)}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="text-[10px] text-muted-foreground">
            Spend is estimated from published Anthropic pricing and your own
            recorded token counts. Cached input is priced at ~10% of regular
            input.
          </p>
        </>
      )}
    </div>
  );
}
