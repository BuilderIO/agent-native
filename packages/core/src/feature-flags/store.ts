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
  /** Salt for a percentage assignment. Absent values preserve v1 buckets. */
  rolloutEpoch?: string;
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

function settingKey(key: string): string {
  return `${FEATURE_FLAG_SETTINGS_PREFIX}${key}`;
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
    rolloutEpoch:
      typeof raw.rolloutEpoch === "string" && raw.rolloutEpoch.trim()
        ? raw.rolloutEpoch.trim()
        : undefined,
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
  const stored = scope.orgId?.trim()
    ? ((await getOrgSetting(scope.orgId, settingKey(key))) ??
      (await getSetting(settingKey(key))))
    : await getSetting(settingKey(key));
  return normalizeFeatureFlagRules(stored);
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
  return normalizeFeatureFlagRules(persisted);
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

export type FeatureFlagDecisionReason =
  | "off"
  | "global"
  | "email"
  | "org"
  | "percentage-control"
  | "percentage-treatment";

export interface FeatureFlagDecision {
  value: boolean;
  reason: FeatureFlagDecisionReason;
  bucket?: number;
  rolloutEpoch?: string;
  rolloutPercentage?: number;
  userKey?: string;
}

export function evaluateFeatureFlagDecisionRules(
  key: string,
  rules: FeatureFlagRules,
  scope: FeatureFlagScope,
): FeatureFlagDecision {
  if (rules.mode === "off") return { value: false, reason: "off" };
  if (rules.mode === "on") return { value: true, reason: "global" };
  const email = scope.userEmail?.trim().toLowerCase();
  if (email && rules.emails.includes(email))
    return { value: true, reason: "email" };
  if (scope.orgId && rules.orgIds.includes(scope.orgId))
    return { value: true, reason: "org" };
  const userKey = scope.userKey?.trim() || email;
  if (!userKey || rules.percentage <= 0)
    return {
      value: false,
      reason: "percentage-control",
      rolloutEpoch: rules.rolloutEpoch,
      rolloutPercentage: rules.percentage,
      userKey,
    };
  const bucket = rolloutBucket(
    `${key}:${rules.rolloutEpoch ? `${rules.rolloutEpoch}:` : ""}${userKey}`,
  );
  const value = bucket < rules.percentage;
  return {
    value,
    reason: value ? "percentage-treatment" : "percentage-control",
    bucket,
    rolloutEpoch: rules.rolloutEpoch,
    rolloutPercentage: rules.percentage,
    userKey,
  };
}

export function evaluateFeatureFlagRules(
  key: string,
  rules: FeatureFlagRules,
  scope: FeatureFlagScope,
): boolean {
  return evaluateFeatureFlagDecisionRules(key, rules, scope).value;
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

export async function evaluateFeatureFlagDecision(
  key: string,
  scope: FeatureFlagScope = {},
): Promise<FeatureFlagDecision> {
  if (!getFeatureFlagDefinition(key)) return { value: false, reason: "off" };
  try {
    return evaluateFeatureFlagDecisionRules(
      key,
      await getFeatureFlagRules(key, scope),
      scope,
    );
  } catch {
    return { value: false, reason: "off" };
  }
}

/** Ergonomic app-action guard. Accepts either a registered definition or its key. */
export async function isFeatureFlagEnabled(
  flag: string | FeatureFlagDefinition,
  scope: FeatureFlagScope = {},
): Promise<boolean> {
  return evaluateFeatureFlag(typeof flag === "string" ? flag : flag.key, scope);
}
