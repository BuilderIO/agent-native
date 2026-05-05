/**
 * Token usage tracking and cost monitoring.
 *
 * Every LLM call made by the framework records a row here so users can
 * see where their spend is going — chat vs automations vs background jobs
 * vs whatever else a template labels its prompts as.
 *
 * Cost is stored as "centicents" (1/100th of a cent) for integer precision.
 */
import { getDbExec, intType, isPostgres } from "../db/client.js";

/**
 * Per-million-token pricing in cents. Cache read is typically ~10% of
 * input; cache write (5m TTL) is ~125%. Pricing is best-effort — keep
 * this table in sync with Anthropic's published prices.
 */
interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICING: Array<{ match: RegExp; pricing: ModelPricing }> = [
  {
    match: /opus/i,
    pricing: { input: 1500, output: 7500, cacheRead: 150, cacheWrite: 1875 },
  },
  {
    match: /haiku/i,
    pricing: { input: 100, output: 500, cacheRead: 10, cacheWrite: 125 },
  },
  // default → sonnet pricing
  {
    match: /.*/,
    pricing: { input: 300, output: 1500, cacheRead: 30, cacheWrite: 375 },
  },
];

function pricingFor(model: string): ModelPricing {
  for (const entry of PRICING) {
    if (entry.match.test(model)) return entry.pricing;
  }
  return PRICING[PRICING.length - 1]!.pricing;
}

export interface UsageRecord {
  ownerEmail: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model: string;
  /** Category for this call — e.g. "chat", "automation", "job", "custom-agent". */
  label?: string;
  /** Optional template/app name (e.g. "mail"). Falls back to AGENT_APP / APP_NAME env. */
  app?: string;
}

let _initPromise: Promise<void> | undefined;

async function ensureUsageTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS token_usage (
          id ${intType()} PRIMARY KEY,
          owner_email TEXT NOT NULL,
          input_tokens ${intType()} NOT NULL DEFAULT 0,
          output_tokens ${intType()} NOT NULL DEFAULT 0,
          cache_read_tokens ${intType()} NOT NULL DEFAULT 0,
          cache_write_tokens ${intType()} NOT NULL DEFAULT 0,
          cost_cents_x100 ${intType()} NOT NULL DEFAULT 0,
          model TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT 'chat',
          app TEXT NOT NULL DEFAULT '',
          created_at ${intType()} NOT NULL
        )
      `);

      // Add columns on older deployments that pre-date the label/cache
      // fields. Each ALTER is wrapped so a dialect without IF NOT EXISTS
      // (SQLite) still makes progress if only some columns are missing.
      const additions: Array<[string, string]> = [
        ["cache_read_tokens", `${intType()} NOT NULL DEFAULT 0`],
        ["cache_write_tokens", `${intType()} NOT NULL DEFAULT 0`],
        ["label", `TEXT NOT NULL DEFAULT 'chat'`],
        ["app", `TEXT NOT NULL DEFAULT ''`],
      ];
      for (const [col, def] of additions) {
        try {
          if (isPostgres()) {
            await client.execute(
              `ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS ${col} ${def}`,
            );
          } else {
            await client.execute(
              `ALTER TABLE token_usage ADD COLUMN ${col} ${def}`,
            );
          }
        } catch {
          // Column already exists — ignore
        }
      }

      try {
        await client.execute(
          `CREATE INDEX IF NOT EXISTS idx_token_usage_owner_created ON token_usage (owner_email, created_at)`,
        );
      } catch {}
    })();
  }
  return _initPromise;
}

/**
 * Calculate cost in centicents (1/100th of a cent).
 * Accepts cache tokens so callers that use prompt caching are priced
 * correctly. Non-cache-aware callers can pass 0 for the cache fields.
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const p = pricingFor(model);
  const toX100 = (tokens: number, costPerM: number) =>
    Math.round((tokens / 1_000_000) * costPerM * 100);
  return (
    toX100(inputTokens, p.input) +
    toX100(outputTokens, p.output) +
    toX100(cacheReadTokens, p.cacheRead) +
    toX100(cacheWriteTokens, p.cacheWrite)
  );
}

/**
 * Record token usage from an LLM call.
 *
 * Accepts an object with the full set of fields. A positional overload
 * remains for backward compatibility with the older 4-arg signature.
 */
export async function recordUsage(record: UsageRecord): Promise<void>;
export async function recordUsage(
  ownerEmail: string,
  inputTokens: number,
  outputTokens: number,
  model: string,
): Promise<void>;
export async function recordUsage(
  recordOrOwner: UsageRecord | string,
  inputTokens?: number,
  outputTokens?: number,
  model?: string,
): Promise<void> {
  const record: UsageRecord =
    typeof recordOrOwner === "string"
      ? {
          ownerEmail: recordOrOwner,
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
          model: model ?? "",
        }
      : recordOrOwner;

  const {
    ownerEmail,
    inputTokens: inTok,
    outputTokens: outTok,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
    model: modelName,
    label,
    app,
  } = record;

  // Skip no-op writes (e.g. a stream aborted before any tokens flowed)
  if (!inTok && !outTok && !cacheReadTokens && !cacheWriteTokens) return;

  await ensureUsageTable();
  const client = getDbExec();
  const costX100 = calculateCost(
    inTok,
    outTok,
    modelName,
    cacheReadTokens,
    cacheWriteTokens,
  );
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const resolvedApp =
    app ?? process.env.AGENT_APP ?? process.env.APP_NAME ?? "";
  const resolvedLabel = label ?? "chat";
  await client.execute({
    sql: `INSERT INTO token_usage
      (id, owner_email, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents_x100, model, label, app, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      ownerEmail,
      inTok,
      outTok,
      cacheReadTokens,
      cacheWriteTokens,
      costX100,
      modelName,
      resolvedLabel,
      resolvedApp,
      Date.now(),
    ],
  });
}

/** Total cost (in cents) charged against a user, across all time. */
export async function getUserUsageCents(ownerEmail: string): Promise<number> {
  await ensureUsageTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT COALESCE(SUM(cost_cents_x100), 0) as total FROM token_usage WHERE owner_email = ?`,
    args: [ownerEmail],
  });
  const total = Number((rows[0] as { total?: number })?.total ?? 0);
  return total / 100;
}

// ─── Admin / UI queries ─────────────────────────────────────────────────

export interface UsageSummaryOptions {
  ownerEmail: string;
  /** Inclusive lower bound (ms since epoch). Defaults to 30 days ago. */
  sinceMs?: number;
}

export interface UsageBucket {
  key: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cents: number;
  calls: number;
}

export interface DailyBucket {
  /** YYYY-MM-DD (UTC) */
  date: string;
  cents: number;
  calls: number;
}

export interface UsageRecentEntry {
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

export interface UsageSummary {
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

const DAY_MS = 86_400_000;

/**
 * Produce an aggregated spend view for the Usage admin panel.
 * Scoped to the passed owner email; the UI always passes the session user.
 */
export async function getUsageSummary(
  options: UsageSummaryOptions,
): Promise<UsageSummary> {
  await ensureUsageTable();
  const client = getDbExec();
  const sinceMs = options.sinceMs ?? Date.now() - 30 * DAY_MS;

  const totalRow = await client.execute({
    sql: `SELECT
      COALESCE(SUM(cost_cents_x100), 0) AS cents,
      COUNT(*) AS calls,
      COALESCE(SUM(input_tokens), 0) AS in_tok,
      COALESCE(SUM(output_tokens), 0) AS out_tok,
      COALESCE(SUM(cache_read_tokens), 0) AS cr_tok,
      COALESCE(SUM(cache_write_tokens), 0) AS cw_tok
      FROM token_usage WHERE owner_email = ? AND created_at >= ?`,
    args: [options.ownerEmail, sinceMs],
  });
  const t = (totalRow.rows[0] ?? {}) as Record<string, number | null>;

  const bucketSql = (col: string) => ({
    sql: `SELECT ${col} AS k,
        COALESCE(SUM(cost_cents_x100), 0) AS cents,
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0) AS in_tok,
        COALESCE(SUM(output_tokens), 0) AS out_tok,
        COALESCE(SUM(cache_read_tokens), 0) AS cr_tok,
        COALESCE(SUM(cache_write_tokens), 0) AS cw_tok
      FROM token_usage
      WHERE owner_email = ? AND created_at >= ?
      GROUP BY ${col}
      ORDER BY cents DESC`,
    args: [options.ownerEmail, sinceMs],
  });

  const mapBuckets = (rows: unknown[]): UsageBucket[] =>
    rows.map((r) => {
      const row = r as Record<string, number | string | null>;
      return {
        key: String(row.k ?? ""),
        cents: Number(row.cents ?? 0) / 100,
        calls: Number(row.calls ?? 0),
        inputTokens: Number(row.in_tok ?? 0),
        outputTokens: Number(row.out_tok ?? 0),
        cacheReadTokens: Number(row.cr_tok ?? 0),
        cacheWriteTokens: Number(row.cw_tok ?? 0),
      };
    });

  const [byLabelR, byModelR, byAppR] = await Promise.all([
    client.execute(bucketSql("label")),
    client.execute(bucketSql("model")),
    client.execute(bucketSql("app")),
  ]);

  // By-day aggregation — done in JS so we don't depend on dialect-specific
  // date functions (SQLite `strftime`, Postgres `to_char`). Cheap enough
  // for a 30-day window; if this grows, swap for a dialect-aware query.
  const dayRows = await client.execute({
    sql: `SELECT created_at, cost_cents_x100 FROM token_usage
      WHERE owner_email = ? AND created_at >= ?`,
    args: [options.ownerEmail, sinceMs],
  });
  const dayMap = new Map<string, { cents: number; calls: number }>();
  for (const row of dayRows.rows as Array<Record<string, number>>) {
    const date = new Date(Number(row.created_at)).toISOString().slice(0, 10);
    const prev = dayMap.get(date) ?? { cents: 0, calls: 0 };
    prev.cents += Number(row.cost_cents_x100 ?? 0);
    prev.calls += 1;
    dayMap.set(date, prev);
  }
  const byDay: DailyBucket[] = [...dayMap.entries()]
    .map(([date, v]) => ({
      date,
      cents: v.cents / 100,
      calls: v.calls,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const recentRows = await client.execute({
    sql: `SELECT id, created_at, label, app, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost_cents_x100
      FROM token_usage
      WHERE owner_email = ?
      ORDER BY created_at DESC
      LIMIT 50`,
    args: [options.ownerEmail],
  });
  const recent: UsageRecentEntry[] = (
    recentRows.rows as Array<Record<string, number | string | null>>
  ).map((row) => ({
    id: Number(row.id),
    createdAt: Number(row.created_at),
    label: String(row.label ?? "chat"),
    app: String(row.app ?? ""),
    model: String(row.model ?? ""),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cacheReadTokens: Number(row.cache_read_tokens ?? 0),
    cacheWriteTokens: Number(row.cache_write_tokens ?? 0),
    cents: Number(row.cost_cents_x100 ?? 0) / 100,
  }));

  return {
    totalCents: Number(t.cents ?? 0) / 100,
    totalCalls: Number(t.calls ?? 0),
    totalInputTokens: Number(t.in_tok ?? 0),
    totalOutputTokens: Number(t.out_tok ?? 0),
    totalCacheReadTokens: Number(t.cr_tok ?? 0),
    totalCacheWriteTokens: Number(t.cw_tok ?? 0),
    sinceMs,
    byLabel: mapBuckets(byLabelR.rows),
    byModel: mapBuckets(byModelR.rows),
    byApp: mapBuckets(byAppR.rows),
    byDay,
    recent,
  };
}
