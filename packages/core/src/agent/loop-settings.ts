import { getDbExec } from "../db/client.js";
import {
  getOrgSetting,
  putOrgSetting,
  deleteOrgSetting,
  getUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "../settings/index.js";

export const AGENT_LOOP_SETTINGS_KEY = "agent-loop";
/**
 * Now that the budget is terminal rather than self-resetting, this has to clear
 * real deep work: production contains a legitimate 117-tool-call analysis, so
 * the old 100 would have cut it off. Runaway turns are caught by repetition
 * detection (`MAX_IDENTICAL_TOOL_CALLS`), not by this ceiling.
 */
export const DEFAULT_AGENT_MAX_ITERATIONS = 400;
export const MIN_AGENT_MAX_ITERATIONS = 1;
export const MAX_AGENT_MAX_ITERATIONS = 1000;

/**
 * Per-TURN input-token ceiling. Iteration count and wall clock alone do not
 * bound spend: cost grows quadratically with tool-call count because every
 * retained tool result is re-sent on each iteration. A measured worst-case
 * production chunk consumed 16.06M input tokens; a normal turn is well under
 * 150k.
 *
 * Deliberately set ABOVE that worst case: this is a runaway backstop, not a
 * work limit. A deep multi-source analysis is allowed to be expensive — the
 * cheap-query-that-spirals case it was meant to catch is caught earlier and
 * more precisely by repetition detection.
 */
export const DEFAULT_AGENT_MAX_RUN_INPUT_TOKENS = 20_000_000;
export const MIN_AGENT_MAX_RUN_INPUT_TOKENS = 10_000;
export const MAX_AGENT_MAX_RUN_INPUT_TOKENS = 200_000_000;

export type AgentLoopSettingsScope = "org" | "user" | "default";
export type AgentLoopSettingsSource = "org" | "user" | "env" | "default";

export interface AgentLoopSettings {
  maxIterations: number;
  defaultMaxIterations: number;
  minMaxIterations: number;
  maxMaxIterations: number;
  /** Per-turn input-token ceiling — see DEFAULT_AGENT_MAX_RUN_INPUT_TOKENS. */
  maxRunInputTokens: number;
  defaultMaxRunInputTokens: number;
  scope: AgentLoopSettingsScope;
  source: AgentLoopSettingsSource;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : null;
  if (n == null || !Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  return n;
}

export function normalizeMaxIterations(
  value: unknown,
  fallback = DEFAULT_AGENT_MAX_ITERATIONS,
): number {
  const parsed = parseInteger(value);
  if (parsed == null) return fallback;
  return Math.min(
    MAX_AGENT_MAX_ITERATIONS,
    Math.max(MIN_AGENT_MAX_ITERATIONS, parsed),
  );
}

export function validateMaxIterationsInput(
  value: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = parseInteger(value);
  if (parsed == null) {
    return { ok: false, error: "maxIterations must be an integer." };
  }
  if (parsed < MIN_AGENT_MAX_ITERATIONS) {
    return {
      ok: false,
      error: `maxIterations must be at least ${MIN_AGENT_MAX_ITERATIONS}.`,
    };
  }
  if (parsed > MAX_AGENT_MAX_ITERATIONS) {
    return {
      ok: false,
      error: `maxIterations must be at most ${MAX_AGENT_MAX_ITERATIONS}.`,
    };
  }
  return { ok: true, value: parsed };
}

export function normalizeMaxRunInputTokens(
  value: unknown,
  fallback = DEFAULT_AGENT_MAX_RUN_INPUT_TOKENS,
): number {
  const parsed = parseInteger(value);
  if (parsed == null) return fallback;
  return Math.min(
    MAX_AGENT_MAX_RUN_INPUT_TOKENS,
    Math.max(MIN_AGENT_MAX_RUN_INPUT_TOKENS, parsed),
  );
}

export function validateMaxRunInputTokensInput(
  value: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = parseInteger(value);
  if (parsed == null) {
    return { ok: false, error: "maxRunInputTokens must be an integer." };
  }
  if (parsed < MIN_AGENT_MAX_RUN_INPUT_TOKENS) {
    return {
      ok: false,
      error: `maxRunInputTokens must be at least ${MIN_AGENT_MAX_RUN_INPUT_TOKENS}.`,
    };
  }
  if (parsed > MAX_AGENT_MAX_RUN_INPUT_TOKENS) {
    return {
      ok: false,
      error: `maxRunInputTokens must be at most ${MAX_AGENT_MAX_RUN_INPUT_TOKENS}.`,
    };
  }
  return { ok: true, value: parsed };
}

export function getDefaultMaxRunInputTokens(): number {
  return normalizeMaxRunInputTokens(
    process.env.AGENT_MAX_RUN_INPUT_TOKENS,
    DEFAULT_AGENT_MAX_RUN_INPUT_TOKENS,
  );
}

function envDefaultSource(): AgentLoopSettingsSource {
  return parseInteger(process.env.AGENT_MAX_ITERATIONS) == null
    ? "default"
    : "env";
}

export function getDefaultMaxIterations(): number {
  return normalizeMaxIterations(
    process.env.AGENT_MAX_ITERATIONS,
    DEFAULT_AGENT_MAX_ITERATIONS,
  );
}

function fromStored(
  stored: Record<string, unknown> | null,
  source: AgentLoopSettingsSource,
  scope: AgentLoopSettingsScope,
): AgentLoopSettings {
  const defaultMaxIterations = getDefaultMaxIterations();
  const defaultMaxRunInputTokens = getDefaultMaxRunInputTokens();
  const hasStoredValue =
    stored && Object.prototype.hasOwnProperty.call(stored, "maxIterations");
  const hasStoredTokenValue =
    stored && Object.prototype.hasOwnProperty.call(stored, "maxRunInputTokens");
  return {
    maxIterations: hasStoredValue
      ? normalizeMaxIterations(stored.maxIterations, defaultMaxIterations)
      : defaultMaxIterations,
    defaultMaxIterations,
    minMaxIterations: MIN_AGENT_MAX_ITERATIONS,
    maxMaxIterations: MAX_AGENT_MAX_ITERATIONS,
    maxRunInputTokens: hasStoredTokenValue
      ? normalizeMaxRunInputTokens(
          stored.maxRunInputTokens,
          defaultMaxRunInputTokens,
        )
      : defaultMaxRunInputTokens,
    defaultMaxRunInputTokens,
    scope,
    source: hasStoredValue ? source : envDefaultSource(),
  };
}

export async function readAgentLoopSettings(ctx: {
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<AgentLoopSettings> {
  if (ctx.orgId) {
    const stored = await getOrgSetting(ctx.orgId, AGENT_LOOP_SETTINGS_KEY);
    return fromStored(stored, "org", "org");
  }

  if (ctx.userEmail) {
    const stored = await getUserSetting(ctx.userEmail, AGENT_LOOP_SETTINGS_KEY);
    return fromStored(stored, "user", "user");
  }

  return fromStored(null, "default", "default");
}

export async function writeAgentLoopSettings(
  ctx: { userEmail?: string | null; orgId?: string | null },
  maxIterations: number,
  maxRunInputTokens?: number,
): Promise<AgentLoopSettings> {
  const validation = validateMaxIterationsInput(maxIterations);
  if (validation.ok === false) {
    throw new Error(validation.error);
  }

  let tokenValue: number | undefined;
  if (maxRunInputTokens !== undefined) {
    const tokenValidation = validateMaxRunInputTokensInput(maxRunInputTokens);
    if (tokenValidation.ok === false) {
      throw new Error(tokenValidation.error);
    }
    tokenValue = tokenValidation.value;
  }

  const stored = {
    maxIterations: validation.value,
    ...(tokenValue === undefined ? {} : { maxRunInputTokens: tokenValue }),
  };

  if (ctx.orgId) {
    await putOrgSetting(ctx.orgId, AGENT_LOOP_SETTINGS_KEY, stored);
    return readAgentLoopSettings(ctx);
  }

  if (!ctx.userEmail) {
    throw new Error("Authentication required to update agent loop settings.");
  }

  await putUserSetting(ctx.userEmail, AGENT_LOOP_SETTINGS_KEY, stored);
  return readAgentLoopSettings(ctx);
}

export async function resetAgentLoopSettings(ctx: {
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<AgentLoopSettings> {
  if (ctx.orgId) {
    await deleteOrgSetting(ctx.orgId, AGENT_LOOP_SETTINGS_KEY);
    return readAgentLoopSettings(ctx);
  }

  if (!ctx.userEmail) {
    throw new Error("Authentication required to update agent loop settings.");
  }

  await deleteUserSetting(ctx.userEmail, AGENT_LOOP_SETTINGS_KEY);
  return readAgentLoopSettings(ctx);
}

export async function canUpdateAgentLoopSettings(
  userEmail: string | null | undefined,
  orgId: string | null | undefined,
): Promise<boolean> {
  if (!userEmail) return false;
  if (!orgId) return true;

  try {
    const exec = getDbExec();
    const { rows } = await exec.execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, userEmail.toLowerCase()],
    });
    const role = String((rows[0] as any)?.role ?? "");
    return role === "owner" || role === "admin";
  } catch {
    return false;
  }
}
