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
export const DEFAULT_AGENT_MAX_ITERATIONS = 100;
export const MIN_AGENT_MAX_ITERATIONS = 1;
export const MAX_AGENT_MAX_ITERATIONS = 1000;

export type AgentLoopSettingsScope = "org" | "user" | "default";
export type AgentLoopSettingsSource = "org" | "user" | "env" | "default";

export interface AgentLoopSettings {
  maxIterations: number;
  defaultMaxIterations: number;
  minMaxIterations: number;
  maxMaxIterations: number;
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
  const hasStoredValue =
    stored && Object.prototype.hasOwnProperty.call(stored, "maxIterations");
  return {
    maxIterations: hasStoredValue
      ? normalizeMaxIterations(stored.maxIterations, defaultMaxIterations)
      : defaultMaxIterations,
    defaultMaxIterations,
    minMaxIterations: MIN_AGENT_MAX_ITERATIONS,
    maxMaxIterations: MAX_AGENT_MAX_ITERATIONS,
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
    const stored = await getUserSetting(
      ctx.userEmail,
      AGENT_LOOP_SETTINGS_KEY,
    );
    return fromStored(stored, "user", "user");
  }

  return fromStored(null, "default", "default");
}

export async function writeAgentLoopSettings(
  ctx: { userEmail?: string | null; orgId?: string | null },
  maxIterations: number,
): Promise<AgentLoopSettings> {
  const validation = validateMaxIterationsInput(maxIterations);
  if (!validation.ok) throw new Error(validation.error);

  if (ctx.orgId) {
    await putOrgSetting(ctx.orgId, AGENT_LOOP_SETTINGS_KEY, {
      maxIterations: validation.value,
    });
    return readAgentLoopSettings(ctx);
  }

  if (!ctx.userEmail) {
    throw new Error("Authentication required to update agent loop settings.");
  }

  await putUserSetting(ctx.userEmail, AGENT_LOOP_SETTINGS_KEY, {
    maxIterations: validation.value,
  });
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
