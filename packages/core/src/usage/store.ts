import { getAppConfig } from "../app-config/index.js";
import { getDbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import { getRequestOrgId } from "../server/request-context.js";

export {
  isSelfScopedUsageRead,
  usageOrgScope,
  type UsageOrgScope,
  type UsageOrgScopeOptions,
} from "./org-scope.js";

interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const BUILDER_AGENT_CREDIT_MARGIN_MULTIPLIER = 1.25;
export const BUILDER_AGENT_CREDITS_PER_USD = 20;

export type UsageBillingUnit = "usd" | "builder-credits" | "mixed";

export interface UsageBillingMode {
  unit: UsageBillingUnit;
  label: string;
  shortLabel: string;
  source:
    | "estimated-provider-cost"
    | "builder-agent-credits"
    | "mixed-provider-usage";
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

export const MIXED_USAGE_BILLING: UsageBillingMode = {
  unit: "mixed",
  label: "Builder credits and provider cost",
  shortLabel: "Mixed",
  source: "mixed-provider-usage",
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
  {
    match: /fable-5/i,
    pricing: { input: 1000, output: 5000, cacheRead: 100, cacheWrite: 1250 },
  },
  {
    match: /opus-4-8/i,
    pricing: { input: 500, output: 2500, cacheRead: 50, cacheWrite: 625 },
  },
  {
    match: /opus/i,
    pricing: { input: 1500, output: 7500, cacheRead: 150, cacheWrite: 1875 },
  },
  {
    match: /haiku/i,
    pricing: { input: 100, output: 500, cacheRead: 10, cacheWrite: 125 },
  },
  {
    match: /gpt-5[.-]6-sol/i,
    pricing: { input: 400, output: 2000, cacheRead: 40, cacheWrite: 500 },
  },
  {
    match: /gpt-5[.-]6-terra/i,
    pricing: { input: 200, output: 1200, cacheRead: 20, cacheWrite: 250 },
  },
  {
    match: /gpt-5[.-]6-luna/i,
    pricing: { input: 20, output: 120, cacheRead: 2, cacheWrite: 25 },
  },
  {
    match: /gpt-5/i,
    pricing: { input: 125, output: 1000, cacheRead: 12.5, cacheWrite: 0 },
  },
  {
    match: /gemini-3[.-]1-pro/i,
    pricing: { input: 125, output: 1000, cacheRead: 31, cacheWrite: 0 },
  },
  {
    match: /gemini-3[.-][0-9]+-flash/i,
    pricing: { input: 15, output: 60, cacheRead: 4, cacheWrite: 0 },
  },
  {
    match: /gemini-2\.5-pro/i,
    pricing: { input: 125, output: 1000, cacheRead: 31, cacheWrite: 0 },
  },
  {
    match: /gemini-2\.5-flash/i,
    pricing: { input: 15, output: 60, cacheRead: 4, cacheWrite: 0 },
  },
  {
    match: /llama-3\.3-70b/i,
    pricing: { input: 59, output: 79, cacheRead: 0, cacheWrite: 0 },
  },
  {
    match: /llama-3\.1-8b|llama3-8b/i,
    pricing: { input: 5, output: 8, cacheRead: 0, cacheWrite: 0 },
  },
  {
    match: /mistral-large/i,
    pricing: { input: 200, output: 600, cacheRead: 0, cacheWrite: 0 },
  },
  {
    match: /mistral-small|mistral-medium/i,
    pricing: { input: 20, output: 60, cacheRead: 0, cacheWrite: 0 },
  },
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
  label?: string;
  app?: string;
  refId?: string;
  costCentsX100?: number;
  builderCreditsUsed?: number;
  engineName?: string;
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

export function resolveUsageAppKey(app?: string | null): string {
  if (app !== null && app !== undefined) return app.trim();
  const config = getAppConfig();
  return (config.app.id ?? config.app.name ?? "").trim();
}

let _initPromise: Promise<void> | undefined;

export async function ensureUsageTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const createSql = `
        CREATE TABLE IF NOT EXISTS token_usage (
          id BIGINT PRIMARY KEY,
          owner_email TEXT NOT NULL,
          input_tokens BIGINT NOT NULL DEFAULT 0,
          output_tokens BIGINT NOT NULL DEFAULT 0,
          cache_read_tokens BIGINT NOT NULL DEFAULT 0,
          cache_write_tokens BIGINT NOT NULL DEFAULT 0,
          cost_cents_x100 BIGINT NOT NULL DEFAULT 0,
          builder_credits_used NUMERIC,
          engine_name TEXT,
          cost_source TEXT NOT NULL DEFAULT 'estimated',
          model TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT 'chat',
          app TEXT NOT NULL DEFAULT '',
          ref_id TEXT NOT NULL DEFAULT '',
          org_id TEXT,
          run_id TEXT,
          thread_id TEXT,
          task_id TEXT,
          -- guard:allow-identity-column integration scope IDs identify an integration record, not a user principal.
          integration_scope_id TEXT,
          source_platform TEXT,
          source_id TEXT,
          created_at BIGINT NOT NULL
        )
      `;

      const additions: Array<[string, string]> = [
        ["cache_read_tokens", `BIGINT NOT NULL DEFAULT 0`],
        ["cache_write_tokens", `BIGINT NOT NULL DEFAULT 0`],
        ["builder_credits_used", "NUMERIC"],
        ["engine_name", "TEXT"],
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

      {
        await ensureTableExists("token_usage", createSql);
        for (const [col, def] of additions) {
          await ensureColumnExists(
            "token_usage",
            col,
            `ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS ${col} ${def}`,
          );
        }
        await widenIntColumnsToBigInt("token_usage", ["created_at"]);
        await ensureIndexExists(
          "idx_token_usage_owner_created",
          `CREATE INDEX IF NOT EXISTS idx_token_usage_owner_created ON token_usage (owner_email, created_at)`,
        );
        // `owner_email` is written as the caller supplied it, so the metrics
        // queries scope with `LOWER(owner_email) IN (…)`. A plain btree cannot
        // serve a function-wrapped predicate: without this expression index the
        // usage panel scans the whole table, which is the highest-row-count one
        // in the system (a row per LLM call, every app and org).
        // NOT built CONCURRENTLY. This runs at release over the pooled Neon
        // endpoint, and a transaction-pooled connection cannot carry
        // `CREATE INDEX CONCURRENTLY` to completion — it returns without
        // creating the index, which then fails the verifying probe and blocks
        // the whole release. The SHARE lock is the cost of a build that lands.
        await ensureIndexExists(
          "idx_token_usage_lower_owner_created",
          `CREATE INDEX IF NOT EXISTS idx_token_usage_lower_owner_created ON token_usage (LOWER(owner_email), created_at)`,
        );
        await ensureIndexExists(
          "idx_token_usage_org_app_created",
          `CREATE INDEX IF NOT EXISTS idx_token_usage_org_app_created ON token_usage (org_id, LOWER(app), created_at)`,
        );
        return;
      }
    })().catch((err) => {
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const p = pricingFor(model);
  const uncachedInputTokens = Math.max(
    0,
    inputTokens - cacheReadTokens - cacheWriteTokens,
  );
  const rawCenticents =
    (uncachedInputTokens / 1_000_000) * p.input * 100 +
    (outputTokens / 1_000_000) * p.output * 100 +
    (cacheReadTokens / 1_000_000) * p.cacheRead * 100 +
    (cacheWriteTokens / 1_000_000) * p.cacheWrite * 100;
  return rawCenticents > 0 ? Math.max(1, Math.round(rawCenticents)) : 0;
}

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
    builderCreditsUsed,
    engineName,
    costSource,
    orgId,
    runId,
    threadId,
    taskId,
    integrationScopeId,
    sourcePlatform,
    sourceId,
  } = record;

  if (
    !inTok &&
    !outTok &&
    !cacheReadTokens &&
    !cacheWriteTokens &&
    builderCreditsUsed == null
  ) {
    return;
  }

  if (
    builderCreditsUsed != null &&
    (!Number.isFinite(builderCreditsUsed) || builderCreditsUsed < 0)
  ) {
    throw new Error("Builder gateway credits must be a non-negative number.");
  }

  await ensureUsageTable();
  const client = getDbExec();
  const resolvedApp = resolveUsageAppKey(app);
  const resolvedLabel = label ?? "chat";
  const resolvedRef = refId ?? "";
  const resolvedOrgId = orgId ?? getRequestOrgId() ?? null;

  if (resolvedRef) {
    await client.execute({
      sql: `DELETE FROM token_usage
        WHERE label = ? AND ref_id = ?
          AND (org_id IS NULL OR org_id = ?)`,
      args: [resolvedLabel, resolvedRef, resolvedOrgId],
    });
  }

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
      (id, owner_email, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents_x100, builder_credits_used, engine_name, cost_source, model, label, app, ref_id, org_id, run_id, thread_id, task_id, integration_scope_id, source_platform, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      ownerEmail,
      inTok,
      outTok,
      cacheReadTokens,
      cacheWriteTokens,
      costX100,
      builderCreditsUsed ?? null,
      engineName ?? null,
      resolvedCostSource,
      modelName,
      resolvedLabel,
      resolvedApp,
      resolvedRef,
      resolvedOrgId,
      runId ?? null,
      threadId ?? null,
      taskId ?? null,
      integrationScopeId ?? null,
      sourcePlatform ?? null,
      sourceId ?? null,
      Date.now(),
    ],
  });

  void import("./alerts-store.js")
    .then(({ enqueueUsageAlertEvaluation }) => {
      return enqueueUsageAlertEvaluation({
        ...record,
        orgId: resolvedOrgId,
      });
    })
    .catch((error) => {
      console.error("[usage-alerts] could not enqueue evaluation:", error);
    });
}

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

export interface UsageSummaryOptions {
  ownerEmail: string;
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
