import {
  defaultFeatureFlagRules,
  evaluateFeatureFlagRules,
  normalizeFeatureFlagRules,
  type FeatureFlagRules,
  type FeatureFlagScope,
} from "../feature-flags/store.js";
import { getOrgSetting } from "../settings/org-settings.js";
import { getSetting } from "../settings/store.js";
import {
  getUserSetting,
  mutateUserSetting,
} from "../settings/user-settings.js";
import { getLabDefinition, listLabs, type LabDefinition } from "./registry.js";

export const LABS_SETTING_KEY = "labs";
const LEGACY_LABS_SETTING_KEY = "experiments";

function validLabSetting(
  key: string,
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
    throw new Error(`Invalid saved lab setting: ${key}`);
  }
  return value;
}

async function getStoredLabs(
  email: string,
  options?: Pick<FeatureFlagScope, "transaction">,
): Promise<Record<string, unknown> | null> {
  const [labs, legacy] = await Promise.all([
    getUserSetting(email, LABS_SETTING_KEY, options),
    getUserSetting(email, LEGACY_LABS_SETTING_KEY, options),
  ]);
  const current = validLabSetting(LABS_SETTING_KEY, labs);
  const previous = validLabSetting(LEGACY_LABS_SETTING_KEY, legacy);
  return current || previous
    ? { ...(previous ?? {}), ...(current ?? {}) }
    : null;
}

export interface UserLabState {
  enabled: boolean;
  source: "choice" | "legacy" | "default";
  legacyValues?: Record<string, boolean>;
  mixed: boolean;
}

function parseLegacyRules(
  key: string,
  value: Record<string, unknown> | null,
): FeatureFlagRules {
  if (value === null) return defaultFeatureFlagRules();
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["off", "on", "rules"].includes(value.mode as string) ||
    (value.emails !== undefined &&
      (!Array.isArray(value.emails) ||
        !value.emails.every((item) => typeof item === "string"))) ||
    (value.orgIds !== undefined &&
      (!Array.isArray(value.orgIds) ||
        !value.orgIds.every((item) => typeof item === "string"))) ||
    (value.percentage !== undefined &&
      (typeof value.percentage !== "number" ||
        !Number.isFinite(value.percentage) ||
        value.percentage < 0 ||
        value.percentage > 100))
  ) {
    throw new Error(`Invalid legacy feature flag rules: ${key}`);
  }
  return normalizeFeatureFlagRules(value);
}

async function getLegacyRules(
  key: string,
  scope: FeatureFlagScope,
): Promise<FeatureFlagRules> {
  const settingKey = `feature-flag:${key}`;
  const orgId = scope.orgId?.trim();
  const [global, org] = await Promise.all([
    getSetting(settingKey, { transaction: scope.transaction }),
    orgId
      ? getOrgSetting(orgId, settingKey, { transaction: scope.transaction })
      : Promise.resolve(null),
  ]);
  return parseLegacyRules(key, org ?? global);
}

export async function getUserLabStates(
  email: string,
  scope: FeatureFlagScope = {},
): Promise<Record<string, UserLabState>> {
  const stored = await getStoredLabs(email, {
    transaction: scope.transaction,
  });
  return resolveStoredLabStates(email, stored, scope);
}

async function resolveStoredLabStates(
  email: string,
  stored: Record<string, unknown> | null,
  scope: FeatureFlagScope,
): Promise<Record<string, UserLabState>> {
  const definitions = listLabs();
  for (const { key } of definitions) {
    if (
      stored &&
      Object.hasOwn(stored, key) &&
      typeof stored[key] !== "boolean"
    ) {
      throw new Error(`Invalid saved lab choice: ${key}`);
    }
  }
  const unresolved = definitions.filter(
    ({ key, legacyFlagKeys }) =>
      typeof stored?.[key] !== "boolean" && legacyFlagKeys?.length,
  );
  const legacyKeys = [
    ...new Set(unresolved.flatMap((lab) => lab.legacyFlagKeys ?? [])),
  ];
  const evaluationScope = { ...scope, userEmail: email };
  const rules = new Map(
    await Promise.all(
      legacyKeys.map(
        async (key) =>
          [key, await getLegacyRules(key, evaluationScope)] as const,
      ),
    ),
  );
  return Object.fromEntries(
    definitions.map((lab) => {
      const choice = stored?.[lab.key];
      if (typeof choice === "boolean") {
        return [lab.key, { enabled: choice, source: "choice", mixed: false }];
      }
      if (lab.legacyFlagKeys?.length) {
        const legacyValues = Object.fromEntries(
          lab.legacyFlagKeys.map((key) => {
            const flagRules = rules.get(key);
            if (!flagRules)
              throw new Error(`Unknown legacy feature flag: ${key}`);
            return [
              key,
              evaluateFeatureFlagRules(key, flagRules, evaluationScope),
            ];
          }),
        );
        const values = Object.values(legacyValues);
        return [
          lab.key,
          {
            enabled: values.every(Boolean),
            source: "legacy",
            legacyValues,
            mixed: values.some(Boolean) && !values.every(Boolean),
          },
        ];
      }
      return [
        lab.key,
        {
          enabled: lab.defaultEnabled === true,
          source: "default",
          mixed: false,
        },
      ];
    }),
  );
}

export async function getUserLabState(
  email: string,
  lab: string | LabDefinition,
  scope: FeatureFlagScope = {},
): Promise<UserLabState> {
  const key = typeof lab === "string" ? lab : lab.key;
  const state = (await getUserLabStates(email, scope))[key];
  if (!state) throw new Error(`Unknown lab: ${key}`);
  return state;
}

export async function getUserLabEnabled(
  email: string,
  lab: string | LabDefinition,
  scope: FeatureFlagScope = {},
): Promise<boolean> {
  return (await getUserLabState(email, lab, scope)).enabled;
}

export function normalizeLabValues(
  stored: Record<string, unknown> | null | undefined,
): Record<string, boolean> {
  return Object.fromEntries(
    listLabs().map(({ key, defaultEnabled }) => [
      key,
      stored?.[key] === true ||
        (stored?.[key] === undefined && defaultEnabled === true),
    ]),
  );
}

export async function getUserLabs(
  email: string,
  scope: FeatureFlagScope = {},
): Promise<Record<string, boolean>> {
  const states = await getUserLabStates(email, scope);
  return Object.fromEntries(
    Object.entries(states).map(([key, state]) => [key, state.enabled]),
  );
}

export async function setUserLab(
  email: string,
  key: string,
  enabled: boolean,
  scope: FeatureFlagScope = {},
): Promise<Record<string, boolean>> {
  if (!getLabDefinition(key)) {
    throw new Error(`Unknown lab: ${key}`);
  }
  let effectiveValues: Record<string, boolean> | undefined;
  await mutateUserSetting(email, LABS_SETTING_KEY, async (current) => {
    validLabSetting(LABS_SETTING_KEY, current);
    const legacy =
      current === null
        ? await getUserSetting(email, LEGACY_LABS_SETTING_KEY)
        : null;
    validLabSetting(LEGACY_LABS_SETTING_KEY, legacy);
    const next = { ...(legacy ?? {}), ...(current ?? {}), [key]: enabled };
    const states = await resolveStoredLabStates(email, next, scope);
    effectiveValues = Object.fromEntries(
      Object.entries(states).map(([labKey, state]) => [labKey, state.enabled]),
    );
    return next;
  });
  return effectiveValues!;
}
