import { getDbExec, type DbExec } from "../db/client.js";
import { mutateOrgSetting, putOrgSetting } from "../settings/org-settings.js";
import {
  getSetting,
  getSettingsRaw,
  mutateSetting,
  putSetting,
} from "../settings/store.js";
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
  transaction?: DbExec;
  userEmail?: string;
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

function hasActiveRollout(rules: FeatureFlagRules): boolean {
  return (
    rules.mode === "on" ||
    (rules.mode === "rules" &&
      (rules.emails.length > 0 ||
        rules.orgIds.length > 0 ||
        rules.percentage > 0))
  );
}

function storedRuleActive(stored: FeatureFlagStoredRule): boolean {
  return stored.state === "set" && hasActiveRollout(stored.rules);
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

export class FeatureFlagRulesError extends Error {
  constructor(
    readonly code: "unregistered" | "malformed" | "follows-global",
    readonly key: string,
    detail: string,
  ) {
    super(`Feature flag ${key}: ${detail}`);
    this.name = "FeatureFlagRulesError";
  }
}

function storedRulesProblem(stored: unknown): string | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    return `stored rules are ${stored === null ? "null" : Array.isArray(stored) ? "a list" : typeof stored}, not an object`;
  const value = stored as Record<string, unknown>;
  if (value.version !== 1)
    return `stored version ${JSON.stringify(value.version) ?? "undefined"} is not 1`;
  if (value.mode !== "off" && value.mode !== "on" && value.mode !== "rules")
    return `stored mode ${JSON.stringify(value.mode)} is not off, on, or rules`;
  for (const field of ["emails", "orgIds"] as const) {
    const list = value[field];
    if (
      list !== undefined &&
      !(Array.isArray(list) && list.every((item) => typeof item === "string"))
    )
      return `stored ${field} is not a list of strings`;
  }
  const percentage = value.percentage;
  if (
    percentage !== undefined &&
    !(
      typeof percentage === "number" &&
      Number.isInteger(percentage) &&
      percentage >= 0 &&
      percentage <= 100
    )
  )
    return "stored percentage is not a whole number from 0 to 100";
  return null;
}

export type FeatureFlagRuleScope = "org" | "global";

/** One stored rule row: absent, readable, or present but unreadable. */
export type FeatureFlagStoredRule =
  | { state: "set"; rules: FeatureFlagRules }
  | { state: "unset" }
  | { state: "unreadable"; problem: string };

export interface FeatureFlagRuleLayers {
  global: FeatureFlagStoredRule;
  org: (FeatureFlagStoredRule & { orgId: string }) | null;
  /** The row evaluation uses for this org: an org row of any shape wins. */
  inEffect: "org" | "global" | "none";
}

function storedRule(value: unknown): FeatureFlagStoredRule {
  const problem = storedRulesProblem(value);
  return problem
    ? { state: "unreadable", problem }
    : { state: "set", rules: normalizeFeatureFlagRules(value) };
}

/**
 * The only judge of whether a stored row can be read. Listing, evaluation,
 * and mutation all read rows through it, so a row an operator sees as
 * unreadable can never evaluate on.
 */
function readStoredRule(raw: string | null): FeatureFlagStoredRule {
  if (raw == null) return { state: "unset" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { state: "unreadable", problem: "stored rules are not JSON" };
  }
  return storedRule(value);
}

function orgSettingKey(orgId: string, key: string): string {
  return `o:${orgId}:${settingKey(key)}`;
}

async function readRuleRows(
  keys: readonly string[],
  orgId: string | null,
  transaction: DbExec | undefined,
): Promise<Map<string, string | null>> {
  return getSettingsRaw(
    keys.flatMap((key) =>
      orgId ? [settingKey(key), orgSettingKey(orgId, key)] : [settingKey(key)],
    ),
    transaction ? { transaction } : undefined,
  );
}

function ruleLayers(
  rows: Map<string, string | null>,
  key: string,
  orgId: string | null,
): FeatureFlagRuleLayers {
  const global = readStoredRule(rows.get(settingKey(key)) ?? null);
  const org = orgId
    ? readStoredRule(rows.get(orgSettingKey(orgId, key)) ?? null)
    : null;
  return {
    global,
    org: org && orgId ? { ...org, orgId } : null,
    inEffect:
      org && org.state !== "unset"
        ? "org"
        : global.state !== "unset"
          ? "global"
          : "none",
  };
}

/** The row that decides for this org, which may be one that can't be read. */
export function featureFlagRuleInEffect(
  layers: FeatureFlagRuleLayers,
): FeatureFlagStoredRule {
  return layers.inEffect === "org" && layers.org ? layers.org : layers.global;
}

/**
 * Reads the global rule and the org's own rule as separate rows, for
 * operators. Evaluation never merges them: an org row replaces the global
 * one for that org, so showing only the evaluated rules hides which row a
 * change has to land in. A malformed row is `unreadable`, not `unset`,
 * because it still takes precedence.
 */
export async function readFeatureFlagRuleLayers(
  key: string,
  scope: Pick<FeatureFlagScope, "orgId" | "transaction">,
): Promise<FeatureFlagRuleLayers> {
  if (!getFeatureFlagDefinition(key))
    throw new FeatureFlagRulesError("unregistered", key, "not registered");
  const orgId = scope.orgId?.trim() || null;
  return ruleLayers(
    await readRuleRows([key], orgId, scope.transaction),
    key,
    orgId,
  );
}

/**
 * Reads the rules evaluation uses. Unconfigured and unreadable rules both
 * read as off; `getFeatureFlagRulesStrict` tells them apart.
 */
export async function getFeatureFlagRules(
  key: string,
  scope: Pick<FeatureFlagScope, "orgId" | "transaction">,
): Promise<FeatureFlagRules> {
  if (!getFeatureFlagDefinition(key)) return defaultFeatureFlagRules();
  const inEffect = featureFlagRuleInEffect(
    await readFeatureFlagRuleLayers(key, scope),
  );
  return inEffect.state === "set" ? inEffect.rules : defaultFeatureFlagRules();
}

/**
 * Reads a flag's rules for callers that route data on it. Unconfigured reads
 * as off, like `getFeatureFlagRules`, but an unregistered key or malformed
 * stored rules throw `FeatureFlagRulesError` instead of normalizing to off:
 * for a routing flag, "off" and "unreadable" choose different write paths.
 */
export async function getFeatureFlagRulesStrict(
  key: string,
  scope: Pick<FeatureFlagScope, "orgId" | "transaction">,
): Promise<FeatureFlagRules> {
  const inEffect = featureFlagRuleInEffect(
    await readFeatureFlagRuleLayers(key, scope),
  );
  if (inEffect.state === "unreadable")
    throw new FeatureFlagRulesError("malformed", key, inEffect.problem);
  return inEffect.state === "set" ? inEffect.rules : defaultFeatureFlagRules();
}

/** The row in effect for each registered key, read in one settings batch. */
export async function getFeatureFlagRulesForKeys(
  keys: readonly string[],
  scope: Pick<FeatureFlagScope, "orgId" | "transaction">,
): Promise<Map<string, FeatureFlagStoredRule>> {
  const uniqueKeys = [...new Set(keys)].filter((key) =>
    getFeatureFlagDefinition(key),
  );
  const result = new Map<string, FeatureFlagStoredRule>();
  if (uniqueKeys.length === 0) return result;
  const orgId = scope.orgId?.trim() || null;
  const rows = await readRuleRows(uniqueKeys, orgId, scope.transaction);
  for (const key of uniqueKeys)
    result.set(key, featureFlagRuleInEffect(ruleLayers(rows, key, orgId)));
  return result;
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

  const { global } = await readFeatureFlagRuleLayers(key, {});
  if (storedRuleActive(global)) {
    await mutateSetting(indexKey, async () => ({
      version: 1,
      global: true,
      orgIds: [],
    }));
    return true;
  }

  const table = "public.settings";
  const { rows } = await getDbExec().execute({
    sql: `SELECT key, value FROM ${table} WHERE key LIKE ?`,
    args: [`o:%:${settingKey(key)}`],
  });
  const orgIds = rows
    .filter((row) => storedRuleActive(readStoredRule(String(row.value))))
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
 * Changes a rule starting from what its row holds. Refuses a row that can't
 * be read, since normalizing it would quietly rewrite it, and refuses to
 * start an org's own rule from the global one, since the org would then stop
 * following later global changes. `replaceFeatureFlagRules` does both
 * explicitly.
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
  const orgId = scope.orgId?.trim() || null;
  const mutate = async (stored: Record<string, unknown> | null) => {
    if (stored === null && orgId) {
      const { global } = await readFeatureFlagRuleLayers(key, {});
      if (global.state !== "unset")
        throw new FeatureFlagRulesError(
          "follows-global",
          key,
          "this organization follows the rule for every organization; replace its rules to give it its own",
        );
    }
    const current: FeatureFlagStoredRule =
      stored === null ? { state: "unset" } : storedRule(stored);
    if (current.state === "unreadable")
      throw new FeatureFlagRulesError("malformed", key, current.problem);
    return {
      ...(await updater(
        current.state === "set" ? current.rules : defaultFeatureFlagRules(),
      )),
    };
  };
  let persisted: Record<string, unknown>;
  try {
    persisted = orgId
      ? await mutateOrgSetting(orgId, settingKey(key), mutate)
      : await mutateSetting(settingKey(key), mutate);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new FeatureFlagRulesError(
        "malformed",
        key,
        "stored rules are not JSON",
      );
    throw error;
  }
  const normalized = normalizeFeatureFlagRules(persisted);
  await syncFeatureFlagRolloutIndex(key, scope, normalized);
  return normalized;
}

/** Writes a whole rule over whatever its row held, readable or not. */
export async function replaceFeatureFlagRules(
  key: string,
  scope: Pick<FeatureFlagScope, "orgId">,
  rules: FeatureFlagRules,
): Promise<FeatureFlagRules> {
  if (!getFeatureFlagDefinition(key)) {
    throw new Error(`Unknown feature flag: ${key}`);
  }
  const orgId = scope.orgId?.trim() || null;
  const normalized = normalizeFeatureFlagRules(rules);
  if (orgId) await putOrgSetting(orgId, settingKey(key), { ...normalized });
  else await putSetting(settingKey(key), { ...normalized });
  await syncFeatureFlagRolloutIndex(key, scope, normalized);
  return normalized;
}

function rolloutBucket(input: string): number {
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

/** A row that can't be read grants nothing, while still replacing the global rule. */
export function evaluateStoredFeatureFlagRule(
  key: string,
  stored: FeatureFlagStoredRule,
  scope: FeatureFlagScope,
): boolean {
  return (
    stored.state === "set" && evaluateFeatureFlagRules(key, stored.rules, scope)
  );
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

export async function evaluateFeatureFlagStrict(
  key: string,
  scope: FeatureFlagScope = {},
): Promise<boolean> {
  if (!getFeatureFlagDefinition(key)) return false;
  return evaluateFeatureFlagRules(
    key,
    await getFeatureFlagRulesStrict(key, scope),
    scope,
  );
}

export async function isFeatureFlagEnabled(
  flag: string | FeatureFlagDefinition,
  scope: FeatureFlagScope = {},
): Promise<boolean> {
  return evaluateFeatureFlag(typeof flag === "string" ? flag : flag.key, scope);
}
