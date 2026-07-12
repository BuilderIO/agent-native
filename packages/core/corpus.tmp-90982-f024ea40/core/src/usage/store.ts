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
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";

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

export const BUILDER_AGENT_CREDIT_MARGIN_MULTIPLIER = 1.25;
export const BUILDER_AGENT_CREDITS_PER_USD = 20;

export type UsageBillingUnit = "usd" | "builder-credits";

export interface UsageBillingMode {
  unit: UsageBillingUnit;
  label: string;
  shortLabel: string;
  source: "estimated-provider-cost" | "builder-agent-credits";
  hardCostMarginMultiplier?: number;
  creditsPerUsd?: number;
}

export const USD_USAGE_BILLING: UsageBillingMode = {
  unit: "usd",
  label: "Estimated spend",
  shortLabel: "Cost",
  source: "estimated-provider-cost",
};

export const BUILDER_CREDIT_USAGE_BILLING: UsageBillingMode = {
  unit: "builder-credits",
  label: "Builder.io credit spend",
  shortLabel: "Credits",
  source: "builder-agent-credits",
  hardCostMarginMultiplier: BUILDER_AGENT_CREDIT_MARGIN_MULTIPLIER,
  creditsPerUsd: BUILDER_AGENT_CREDITS_PER_USD,
};

export function usageBillingForEngine(
  engineName: string | null | undefined,
): UsageBillingMode {
  return engineName === "builder"
    ? BUILDER_CREDIT_USAGE_BILLING
    : USD_USAGE_BILLING;
}

export function builderCreditsFromCostCents(cents: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  const dollars = cents / 100;
  const credits =
    dollars *
    BUILDER_AGENT_CREDIT_MARGIN_MULTIPLIER *
    BUILDER_AGENT_CREDITS_PER_USD;
  return Math.ceil(credits * 1000) / 1000;
}

const PRICING: Array<{ match: RegExp; pricing: ModelPricing }> = [
  // ── Anthropic ──────────────────────────────────────────────────────────────
  // claude-fable-5: $10/$50 per MTok (Mythos-class, launched 2026-06-09)
  {
    match: /fable-5/i,
    pricing: { input: 1000, output: 5000, cacheRead: 100, cacheWrite: 1250 },
  },
  // claude-opus-4-8: $5/$25 standard mode (fast mode same as fable-5 $10/$50)
  // Use standard-mode pricing as default; fast-mode is a separate model id.
  {
    match: /opus-4-8/i,
    pricing: { input: 500, output: 2500, cacheRead: 50, cacheWrite: 625 },
  },
  // claude-opus-4-7 and older opus: ~$15/$75 per MTok
  {
    match: /opus/i,
    pricing: { input: 1500, output: 7500, cacheRead: 150, cacheWrite: 1875 },
  },
  {
    match: /haiku/i,
    pricing: { input: 100, output: 500, cacheRead: 10, cacheWrite: 125 },
  },
  // ── OpenAI / Codex ──────────────────────────────────────────────────────────
  // Published rates as of 2026-07; OpenAI bills cached input at a discount
  // and has no separate cache-write token charge, so cacheWrite is 0. Sol and
  // Terra have higher large-context rates after 272K tokens; this table tracks
  // the standard rate because usage rows do not preserve request context size.
  {
    match: /gpt-5[.-]6-sol/i,
    pricing: { input: 500, output: 3000, cacheRead: 50, cacheWrite: 0 },
  },
  {
    match: /gpt-5[.-]6-terra/i,
    pricing: { input: 250, output: 1500, cacheRead: 25, cacheWrite: 0 },
  },
  {
    match: /gpt-5[.-]6-luna/i,
    pricing: { input: 100, output: 600, cacheRead: 10, cacheWrite: 0 },
  },
  {
    match: /gpt-5/i,
    pricing: { input: 125, output: 1000, cacheRead: 12.5, cacheWrite: 0 },
  },
  // ── Google Gemini ───────────────────────────────────────────────────────────
  // Gemini 3 Pro / 3.1 Pro: ~$1.25/$10 per MTok (approximate; verify on billing)
  {
    match: /gemini-3[.-]1-pro/i,
    pricing: { input: 125, output: 1000, cacheRead: 31, cacheWrite: 0 },
  },
  // Gemini 3.5 Flash / 3 Flash: ~$0.15/$0.60 per MTok
  {
    match: /gemini-3[.-][0-9]+-flash/i,
    pricing: { input: 15, output: 60, cacheRead: 4, cacheWrite: 0 },
  },
  // Gemini 2.5 Pro/Flash (catch-all for older 2.5)
  {
    match: /gemini-2\.5-pro/i,
    pricing: { input: 125, output: 1000, cacheRead: 31, cacheWrite: 0 },
  },
  {
    match: /gemini-2\.5-flash/i,
    pricing: { input: 15, output: 60, cacheRead: 4, cacheWrite: 0 },
  },
  // ── Groq ────────────────────────────────────────────────────────────────────
  // Groq Llama 3.3 70B: $0.59/$0.79 per MTok
  {
    match: /llama-3\.3-70b/i,
    pricing: { input: 59, output: 79, cacheRead: 0, cacheWrite: 0 },
  },
  // Groq Llama 3.1 8B instant: $0.05/$0.08 per MTok
  {
    match: /llama-3\.1-8b|llama3-8b/i,
    pricing: { input: 5, output: 8, cacheRead: 0, cacheWrite: 0 },
  },
  // ── Mistral ─────────────────────────────────────────────────────────────────
  // Mistral Large: ~$2/$6 per MTok
  {
    match: /mistral-large/i,
    pricing: { input: 200, output: 600, cacheRead: 0, cacheWrite: 0 },
  },
  // Mistral Small/Medium: ~$0.2/$0.6 per MTok
  {
    match: /mistral-small|mistral-medium/i,
    pricing: { input: 20, output: 60, cacheRead: 0, cacheWrite: 0 },
  },
  // default → sonnet pricing ($3/$15 per MTok)
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
  /**
   * Stable id of the thing this usage belongs to (e.g. a recap plan id). When
   * set, any prior row(s) with the same (label, refId) are deleted before
   * insert, so re-recording the same run overwrites instead of double-counting.
   */
  refId?: string;
  /**
   * Precomputed cost in centicents (1/100¢). When provided, it is stored
   * verbatim instead of being derived from tokens — e.g. to mirror a
   * provider-reported dollar cost so two surfaces agree exactly.
   */
  costCentsX100?: number;
  /** Whether cost is provider-reported, estimated, or unavailable. */
  costSource?: UsageCostSource;
  orgId?: string;
  runId?: string;
  threadId?: string;
  taskId?: string;
  integrationScopeId?: string;
  sourcePlatform?: string;
  sourceId?: string;
}

export type UsageCostSource = "reported" | "estimated" | "unavailable";

let _initPromise: Promise<void> | undefined;

async function ensureUsageTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `
        CREATE TABLE IF NOT EXISTS token_usage (
          id ${intType()} PRIMARY KEY,
          owner_email TEXT NOT NULL,
          input_tokens ${intType()} NOT NULL DEFAULT 0,
          output_tokens ${intType()} NOT NULL DEFAULT 0,
          cache_read_tokens ${intType()} NOT NULL DEFAULT 0,
          cache_write_tokens ${intType()} NOT NULL DEFAULT 0,
          cost_cents_x100 ${intType()} NOT NULL DEFAULT 0,
          cost_source TEXT NOT NULL DEFAULT 'estimated',
          model TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT 'chat',
          app TEXT NOT NULL DEFAULT '',
          ref_id TEXT NOT NULL DEFAULT '',
          org_id TEXT,
          run_id TEXT,
          thread_id TEXT,
          task_id TEXT,
          integration_scope_id TEXT,
          source_platform TEXT,
          source_id TEXT,
          created_at ${intType()} NOT NULL
        )
      `;

      // Additive columns for older deployments that pre-date the label/cache fields.
      const additions: Array<[string, string]> = [
        ["cache_read_tokens", `${intType()} NOT NULL DEFAULT 0`],
        ["cache_write_tokens", `${intType()} NOT NULL DEFAULT 0`],
        ["cost_source", `TEXT NOT NULL DEFAULT 'estimated'`],
        ["label", `TEXT NOT NULL DEFAULT 'chat'`],
        ["app", `TEXT NOT NULL DEFAULT ''`],
        ["ref_id", `TEXT NOT NULL DEFAULT ''`],
        ["org_id", "TEXT"],
        ["run_id", "TEXT"],
        ["thread_id", "TEXT"],
        ["task_id", "TEXT"],
        ["integration_scope_id", "TEXT"],
        ["source_platform", "TEXT"],
        ["source_id", "TEXT"],
      ];

      if (isPostgres()) {
        // Hot path: the `token_usage` table and its index are virtually always
        // already present in production. Issuing `CREATE TABLE`/`ALTER TABLE`/
        // `CREATE INDEX` still takes a lock that, in a fresh background-worker
        // process behind a concurrent connection on the shared Neon DB, can
        // block ~indefinitely. The ensure* wrappers probe `information_schema`/
        // `pg_indexes` first (plain reads, no lock) and run DDL ONLY for what is
        // actually missing, bounded by a transaction-scoped `lock_timeout`. If a
        // swallowed lock-timeout leaves the schema still missing they RE-PROBE
        // and THROW rather than letting init memoize success against absent
        // schema.
        await ensureTableExists("token_usage", createSql);
        // Add columns on older deployments — guarded so the hot path (columns
        // already present) skips the ACCESS EXCLUSIVE ALTER.
        for (const [col, def] of additions) {
          await ensureColumnExists(
            "token_usage",
            col,
            `ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS ${col} ${def}`,
          );
        }
        // Older deployments created `created_at` as 32-bit `INTEGER`; on Postgres
        // the `Date.now()` written per run by recordUsage() overflows int4. Widen
        // it in place (no-op once done / on fresh BIGINT databases).
        await widenIntColumnsToBigInt("token_usage", ["created_at"]);
        // Probe pg_indexes first (no lock) and skip the SHARE-locking CREATE
        // INDEX when the index is already present.
        await ensureIndexExists(
          "idx_token_usage_owner_created",
          `CREATE INDEX IF NOT EXISTS idx_token_usage_owner_created ON token_usage (owner_email, created_at)`,
        );
        return;
      }

      // SQLite (local dev): no lock problem — keep the original behaviour.
      await client.execute(createSql);
      // Add columns on older deployments that pre-date the label/cache
      // fields. Each ALTER is wrapped so a dialect without IF NOT EXISTS
      // (SQLite) still makes progress if only some columns are missing.
      for (const [col, def] of additions) {
        try {
          await client.execute(
            `ALTER TABLE token_usage ADD COLUMN ${col} ${def}`,
          );
        } catch {
          // Column already exists — ignore
        }
      }
      // Older deployments created `created_at` as 32-bit `INTEGER`; on Postgres
      // the `Date.now()` written per run by recordUsage() overflows int4. Widen
      // it in place (no-op once done / on fresh BIGINT databases).
      await widenIntColumnsToBigInt("token_usage", ["created_at"]);
      try {
        await client.execute(
          `CREATE INDEX IF NOT EXISTS idx_token_usage_owner_created ON token_usage (owner_email, created_at)`,
        );
      } catch {}
    })().catch((err) => {
      // Retry init on the next call after a failed startup.
      _initPromise = undefined;
      throw err;
    });
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
  const rawCenticents =
    (inputTokens / 1_000_000) * p.input * 100 +
    (outputTokens / 1_000_000) * p.output * 100 +
    (cacheReadTokens / 1_000_000) * p.cacheRead * 100 +
    (cacheWriteTokens / 1_000_000) * p.cacheWrite * 100;
  return rawCenticents > 0 ? Math.max(1, Math.round(rawCenticents)) : 0;
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
    refId,
    costCentsX100,
    costSource,
    orgId,
    runId,
    threadId,
    taskId,
    integrationScopeId,
    sourcePlatform,
    sourceId,
  } = record;

  // Skip no-op writes (e.g. a stream aborted before any tokens flowed)
  if (!inTok && !outTok && !cacheReadTokens && !cacheWriteTokens) return;

  await ensureUsageTable();
  const client = getDbExec();
  const resolvedApp =
    app ?? process.env.AGENT_APP ?? process.env.APP_NAME ?? "";
  const resolvedLabel = label ?? "chat";
  const resolvedRef = refId ?? "";

  // Replace any prior usage for this (label, refId) so re-recording the same
  // run — e.g. a recap regenerated on a PR re-push — overwrites instead of
  // double-counting. No-op when refId is unset (the common per-call path).
  if (resolvedRef) {
    await client.execute({
      sql: `DELETE FROM token_usage WHERE label = ? AND ref_id = ?`,
      args: [resolvedLabel, resolvedRef],
    });
  }

  // Prefer an explicit precomputed cost (e.g. a provider-reported dollar cost);
  // otherwise derive it from tokens via the pricing table.
  const resolvedCostSource =
    costSource ?? (costCentsX100 == null ? "estimated" : "reported");
  const costX100 =
    resolvedCostSource === "unavailable"
      ? 0
      : (costCentsX100 ??
        calculateCost(
          inTok,
          outTok,
          modelName,
          cacheReadTokens,
          cacheWriteTokens,
        ));
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  await client.execute({
    sql: `INSERT INTO token_usage
      (id, owner_email, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents_x100, cost_source, model, label, app, ref_id, org_id, run_id, thread_id, task_id, integration_scope_id, source_platform, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      ownerEmail,
      inTok,
      outTok,
      cacheReadTokens,
      cacheWriteTokens,
      costX100,
      resolvedCostSource,
      modelName,
      resolvedLabel,
      resolvedApp,
      resolvedRef,
      orgId ?? null,
      runId ?? null,
      threadId ?? null,
      taskId ?? null,
      integrationScopeId ?? null,
      sourcePlatform ?? null,
      sourceId ?? null,
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
  cost: UsageCostAggregate;
  calls: number;
}

export interface DailyBucket {
  /** YYYY-MM-DD (UTC) */
  date: string;
  cents: number;
  cost: UsageCostAggregate;
  calls: number;
}

export type UsageCostAggregate =
  | { status: "known"; knownCents: number; unavailableCalls: 0 }
  | { status: "partial"; knownCents: number; unavailableCalls: number }
  | { status: "unavailable"; knownCents: 0; unavailableCalls: number };

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
  costSource: UsageCostSource;
}

export interface UsageSummary {
  billing?: UsageBillingMode;
  /** Legacy known-cost subtotal. Use totalCost to preserve unavailable spend. */
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
      COALESCE(SUM(CASE WHEN cost_source = 'unavailable' THEN 0 ELSE cost_cents_x100 END), 0) AS known_cents,
      COALESCE(SUM(CASE WHEN cost_source = 'unavailable' THEN 1 ELSE 0 END), 0) AS unavailable_calls,
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
        COALESCE(SUM(CASE WHEN cost_source = 'unavailable' THEN 0 ELSE cost_cents_x100 END), 0) AS known_cents,
        COALESCE(SUM(CASE WHEN cost_source = 'unavailable' THEN 1 ELSE 0 END), 0) AS unavailable_calls,
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0) AS in_tok,
        COALESCE(SUM(output_tokens), 0) AS out_tok,
        COALESCE(SUM(cache_read_tokens), 0) AS cr_tok,
        COALESCE(SUM(cache_write_tokens), 0) AS cw_tok
      FROM token_usage
      WHERE owner_email = ? AND created_at >= ?
      GROUP BY ${col}
      ORDER BY known_cents DESC`,
    args: [options.ownerEmail, sinceMs],
  });

  const mapBuckets = (rows: unknown[]): UsageBucket[] =>
    rows.map((r) => {
      const row = r as Record<string, number | string | null>;
      const knownCents = Number(row.known_cents ?? 0) / 100;
      const unavailableCalls = Number(row.unavailable_calls ?? 0);
      return {
        key: String(row.k ?? ""),
        cents: knownCents,
        cost: buildUsageCostAggregate(knownCents, unavailableCalls),
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
    sql: `SELECT created_at, cost_cents_x100, cost_source FROM token_usage
      WHERE owner_email = ? AND created_at >= ?`,
    args: [options.ownerEmail, sinceMs],
  });
  const dayMap = new Map<
    string,
    { knownCentsX100: number; unavailableCalls: number; calls: number }
  >();
  for (const row of dayRows.rows as Array<Record<string, number | string>>) {
    const date = new Date(Number(row.created_at)).toISOString().slice(0, 10);
    const prev = dayMap.get(date) ?? {
      knownCentsX100: 0,
      unavailableCalls: 0,
      calls: 0,
    };
    if (row.cost_source === "unavailable") prev.unavailableCalls += 1;
    else prev.knownCentsX100 += Number(row.cost_cents_x100 ?? 0);
    prev.calls += 1;
    dayMap.set(date, prev);
  }
  const byDay: DailyBucket[] = [...dayMap.entries()]
    .map(([date, v]) => {
      const knownCents = v.knownCentsX100 / 100;
      return {
        date,
        cents: knownCents,
        cost: buildUsageCostAggregate(knownCents, v.unavailableCalls),
        calls: v.calls,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const recentRows = await client.execute({
    sql: `SELECT id, created_at, label, app, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost_cents_x100, cost_source
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
    costSource: String(row.cost_source ?? "estimated") as UsageCostSource,
  }));

  const knownCents = Number(t.known_cents ?? 0) / 100;
  const unavailableCalls = Number(t.unavailable_calls ?? 0);
  return {
    billing: USD_USAGE_BILLING,
    totalCents: knownCents,
    totalCost: buildUsageCostAggregate(knownCents, unavailableCalls),
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

function buildUsageCostAggregate(
  knownCents: number,
  unavailableCalls: number,
): UsageCostAggregate {
  if (unavailableCalls === 0) {
    return { status: "known", knownCents, unavailableCalls: 0 };
  }
  if (knownCents === 0) {
    return { status: "unavailable", knownCents: 0, unavailableCalls };
  }
  return { status: "partial", knownCents, unavailableCalls };
}
