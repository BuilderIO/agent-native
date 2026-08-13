import { getDbExec, isPostgres } from "../db/client.js";
import { getOrgSetting, mutateOrgSetting } from "../settings/org-settings.js";
import { getSetting, mutateSetting } from "../settings/store.js";
import {
  getFeatureFlagDefinition,
  type FeatureFlagDefinition,
} from "./registry.js";

export type FeatureFlagMode = "off" | "on" | "rules";

export interface FeatureFlagRules {
  version: 1;
  mode: FeatureFlagMode;
  emails: string[];
  orgIds: string[];
  percentage: number;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface FeatureFlagScope {
  userEmail?: string;
  /** Canonical authenticated identity. V1 callers use normalized email. */
  userKey?: string;
  orgId?: string | null;
}

export const FEATURE_FLAG_SETTINGS_PREFIX = "feature-flag:";
const FEATURE_FLAG_ROLLOUT_INDEX_PREFIX = "feature-flag-rollout-index:";

function settingKey(key: string): string {
  return `${FEATURE_FLAG_SETTINGS_PREFIX}${key}`;
}

function rolloutIndexKey(key: string): string {
  return `${FEATURE_FLAG_ROLLOUT_INDEX_PREFIX}${key}`;
}

function parseStoredRules(value: unknown): FeatureFlagRules {
  if (typeof value === "string")
    return normalizeFeatureFlagRules(JSON.parse(value));
  return normalizeFeatureFlagRules(value);
}

function hasActiveRollout(rules: FeatureFlagRules): boolean {
  return (
    rules.mode === "on" ||
    (rules.mode === "rules" &&
      (rules.emails.length > 0 ||
        rules.orgIds.length > 0 ||
        rules.percentage > 0))
  );
}

interface FeatureFlagRolloutIndex {
  version: 1;
  global: boolean;
  orgIds: string[];
}

function normalizeFeatureFlagRolloutIndex(
  value: unknown,
): FeatureFlagRolloutIndex | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const orgIds = Array.isArray(raw.orgIds)
    ? [
        ...new Set(
          raw.orgIds.filter((item): item is string => typeof item === "string"),
        ),
      ]
        .map((orgId) => orgId.trim())
        .filter(Boolean)
        .sort()
    : [];
  return {
    version: 1,
    global: raw.global === true,
    orgIds,
  };
}

function activeFeatureFlagRolloutIndex(
  index: FeatureFlagRolloutIndex,
): boolean {
  return index.global || index.orgIds.length > 0;
}

async function syncFeatureFlagRolloutIndex(
  key: string,
  scope: Pick<FeatureFlagScope, "orgId">,
  rules: FeatureFlagRules,
): Promise<void> {
  const indexKey = rolloutIndexKey(key);
  await mutateSetting(indexKey, async (current) => {
    const next = normalizeFeatureFlagRolloutIndex(current) ?? {
      version: 1 as const,
      global: false,
      orgIds: [],
    };
    if (scope.orgId?.trim()) {
      const orgId = scope.orgId.trim();
      const active = hasActiveRollout(rules);
      const orgIds = active
        ? [...new Set([...next.orgIds, orgId])].sort()
        : next.orgIds.filter((value) => value !== orgId);
      return {
        ...next,
        orgIds,
      };
    }
    return {
      ...next,
      global: hasActiveRollout(rules),
    };
  });
}

export function defaultFeatureFlagRules(): FeatureFlagRules {
  return {
    version: 1,
    mode: "off",
    emails: [],
    orgIds: [],
    percentage: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

export function normalizeFeatureFlagRules(value: unknown): FeatureFlagRules {
  if (!value || typeof value !== "object") return defaultFeatureFlagRules();
  const raw = value as Record<string, unknown>;
  const mode: FeatureFlagMode =
    raw.mode === "on" || raw.mode === "rules" || raw.mode === "off"
      ? raw.mode
      : "off";
  const percentage =
    typeof raw.percentage === "number" && Number.isFinite(raw.percentage)
      ? Math.max(0, Math.min(100, Math.floor(raw.percentage)))
      : 0;
  return {
    version: 1,
    mode,
    emails: stringList(raw.emails).map((email) => email.toLowerCase()),
    orgIds: stringList(raw.orgIds),
    percentage,
    updatedAt:
      typeof raw.updatedAt === "number" && Number.isSafeInteger(raw.updatedAt)
        ? raw.updatedAt
        : null,
    updatedBy:
      typeof raw.updatedBy === "string" && raw.updatedBy.trim()
        ? raw.updatedBy.trim().toLowerCase()
        : null,
  };
}

export async function getFeatureFlagRules(
  key: string,
  scope: Pick<FeatureFlagScope, "orgId">,
): Promise<FeatureFlagRules> {
  if (!getFeatureFlagDefinition(key)) return defaultFeatureFlagRules();
  // An organization-specific rule overrides the global rule. The fallback is
  // what makes global exact-org targeting meaningful for callers in an org.
  // Most flags have no org override, so `??` made the common path two serial
  // round trips; both settings rows are independent, so read them together.
  const orgId = scope.orgId?.trim();
  if (!orgId)
    return normalizeFeatureFlagRules(await getSetting(settingKey(key)));
  const [orgStored, globalStored] = await Promise.all([
    getOrgSetting(orgId, settingKey(key)),
    getSetting(settingKey(key)),
  ]);
  return normalizeFeatureFlagRules(orgStored ?? globalStored);
}

/**
 * Anonymous discovery hint for a rollout that may be scoped to an org.
 *
 * This deliberately answers only whether some active rollout exists. It does
 * not reveal the target email or organization, and callers must still run
 * `evaluateFeatureFlag` with the authenticated scope before granting access.
 * Without this separate hint, an org-only rollout is invisible to Desktop
 * before the user has authenticated and the org can be resolved.
 */
export async function hasActiveFeatureFlagRollout(
  key: string,
): Promise<boolean> {
  if (!getFeatureFlagDefinition(key)) return false;
  const indexKey = rolloutIndexKey(key);
  const storedIndex = normalizeFeatureFlagRolloutIndex(
    await getSetting(indexKey),
  );
  if (storedIndex) return activeFeatureFlagRolloutIndex(storedIndex);

  const globalStored = await getSetting(settingKey(key));
  const globalActive = hasActiveRollout(parseStoredRules(globalStored));
  if (globalActive) {
    await mutateSetting(indexKey, async () => ({
      version: 1,
      global: true,
      orgIds: [],
    }));
    return true;
  }

  const table = isPostgres() ? "public.settings" : "settings";
  const { rows } = await getDbExec().execute({
    sql: `SELECT key, value FROM ${table} WHERE key LIKE ?`,
    args: [`o:%:${settingKey(key)}`],
  });
  const orgIds = rows
    .filter((row) => hasActiveRollout(parseStoredRules(row.value)))
    .map((row) => {
      const match = /^o:([^:]+):/.exec((row.key as string | undefined) ?? "");
      return match?.[1] ?? null;
    })
    .filter((orgId): orgId is string => Boolean(orgId))
    .sort();
  await mutateSetting(indexKey, async () => ({
    version: 1,
    global: false,
    orgIds,
  }));
  return orgIds.length > 0;
}

/**
 * Atomically derive one flag's scoped rules. An org's first override starts
 * from the global fallback, then becomes independently CAS-protected.
 */
export async function mutateFeatureFlagRules(
  key: string,
  scope: Pick<FeatureFlagScope, "orgId">,
  updater: (
    current: FeatureFlagRules,
  ) => FeatureFlagRules | Promise<FeatureFlagRules>,
): Promise<FeatureFlagRules> {
  if (!getFeatureFlagDefinition(key)) {
    throw new Error(`Unknown feature flag: ${key}`);
  }
  const mutate = async (stored: Record<string, unknown> | null) => {
    const fallback =
      stored == null && scope.orgId?.trim()
        ? await getSetting(settingKey(key))
        : null;
    return {
      ...(await updater(normalizeFeatureFlagRules(stored ?? fallback))),
    };
  };
  const persisted = scope.orgId?.trim()
    ? await mutateOrgSetting(scope.orgId, settingKey(key), mutate)
    : await mutateSetting(settingKey(key), mutate);
  const normalized = normalizeFeatureFlagRules(persisted);
  await syncFeatureFlagRolloutIndex(key, scope, normalized);
  return normalized;
}

function rolloutBucket(input: string): number {
  // FNV-1a is deliberately tiny, deterministic, and independent of runtime.
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

export function evaluateFeatureFlagRules(
  key: string,
  rules: FeatureFlagRules,
  scope: FeatureFlagScope,
): boolean {
  if (rules.mode === "off") return false;
  if (rules.mode === "on") return true;
  const email = scope.userEmail?.trim().toLowerCase();
  if (email && rules.emails.includes(email)) return true;
  if (scope.orgId && rules.orgIds.includes(scope.orgId)) return true;
  const userKey = scope.userKey?.trim() || email;
  if (!userKey || rules.percentage <= 0) return false;
  return rolloutBucket(`${key}:${userKey}`) < rules.percentage;
}

export async function evaluateFeatureFlag(
  key: string,
  scope: FeatureFlagScope = {},
): Promise<boolean> {
  if (!getFeatureFlagDefinition(key)) return false;
  try {
    return evaluateFeatureFlagRules(
      key,
      await getFeatureFlagRules(key, scope),
      scope,
    );
  } catch {
    // A feature flag must never become an availability dependency.
    return false;
  }
}

/** Ergonomic app-action guard. Accepts either a registered definition or its key. */
export async function isFeatureFlagEnabled(
  flag: string | FeatureFlagDefinition,
  scope: FeatureFlagScope = {},
): Promise<boolean> {
  return evaluateFeatureFlag(typeof flag === "string" ? flag : flag.key, scope);
}
