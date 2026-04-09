/**
 * Token usage tracking and cost limits.
 * Tracks per-user API token consumption and enforces spending limits
 * for hosted production deployments.
 */
import { getDbExec, intType } from "../db/client.js";

/** Default usage limit per user in cents ($1.00) */
export const DEFAULT_USAGE_LIMIT_CENTS = 100;

/** Cost per million tokens in cents — Haiku 4.5 pricing */
const HAIKU_INPUT_COST_PER_MTOK = 80; // $0.80
const HAIKU_OUTPUT_COST_PER_MTOK = 400; // $4.00

/** Cost per million tokens in cents — Sonnet pricing */
const SONNET_INPUT_COST_PER_MTOK = 300; // $3.00
const SONNET_OUTPUT_COST_PER_MTOK = 1500; // $15.00

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
          cost_cents_x100 ${intType()} NOT NULL DEFAULT 0,
          model TEXT NOT NULL DEFAULT '',
          created_at ${intType()} NOT NULL
        )
      `);
      // For id generation on SQLite we rely on rowid; on Postgres use a sequence.
      // Using timestamp-based IDs to avoid needing AUTOINCREMENT.
    })();
  }
  return _initPromise;
}

/**
 * Calculate cost in cents * 100 (for integer precision) given token counts and model.
 * Returns cost in "centicents" (1/100th of a cent) so we can store as integer.
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  const isHaiku = model.includes("haiku");
  const inputCost = isHaiku
    ? HAIKU_INPUT_COST_PER_MTOK
    : SONNET_INPUT_COST_PER_MTOK;
  const outputCost = isHaiku
    ? HAIKU_OUTPUT_COST_PER_MTOK
    : SONNET_OUTPUT_COST_PER_MTOK;

  // cost_cents_x100 = (tokens / 1_000_000) * cost_per_mtok * 100
  const inputCostX100 = Math.round((inputTokens / 1_000_000) * inputCost * 100);
  const outputCostX100 = Math.round(
    (outputTokens / 1_000_000) * outputCost * 100,
  );
  return inputCostX100 + outputCostX100;
}

/**
 * Record token usage for a user after an agent run.
 */
export async function recordUsage(
  ownerEmail: string,
  inputTokens: number,
  outputTokens: number,
  model: string,
): Promise<void> {
  await ensureUsageTable();
  const client = getDbExec();
  const costX100 = calculateCost(inputTokens, outputTokens, model);
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  await client.execute({
    sql: `INSERT INTO token_usage (id, owner_email, input_tokens, output_tokens, cost_cents_x100, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      ownerEmail,
      inputTokens,
      outputTokens,
      costX100,
      model,
      Date.now(),
    ],
  });
}

/**
 * Get total usage cost for a user in cents.
 */
export async function getUserUsageCents(ownerEmail: string): Promise<number> {
  await ensureUsageTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT COALESCE(SUM(cost_cents_x100), 0) as total FROM token_usage WHERE owner_email = ?`,
    args: [ownerEmail],
  });
  const total = Number((rows[0] as { total?: number })?.total ?? 0);
  // Convert from centicents to cents
  return total / 100;
}

/**
 * Check if a user has exceeded their usage limit.
 * Returns { allowed: true } or { allowed: false, usageCents, limitCents }.
 */
export async function checkUsageLimit(
  ownerEmail: string,
  limitCents?: number,
): Promise<
  | { allowed: true; usageCents: number; limitCents: number }
  | { allowed: false; usageCents: number; limitCents: number }
> {
  const limit = limitCents ?? DEFAULT_USAGE_LIMIT_CENTS;
  const usageCents = await getUserUsageCents(ownerEmail);
  return {
    allowed: usageCents < limit,
    usageCents,
    limitCents: limit,
  };
}
