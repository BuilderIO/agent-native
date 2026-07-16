import { randomUUID } from "node:crypto";

import { signA2AToken } from "@agent-native/core/a2a";
import { fetchOrgApps, type OrgApp } from "@agent-native/core/mcp";

import type { AnalyticsAdminContext } from "./db-admin-connections.js";

const TARGET_TIMEOUT_MS = 3_000;
const CONCURRENCY = 4;

export type FleetFlagState =
  | "ready"
  | "no-definitions"
  | "unsupported"
  | "unreachable"
  | "forbidden"
  | "unknown-legacy";

export interface FleetFlagApp {
  appId: string;
  appName: string;
  appOrigin: string;
  state: FleetFlagState;
  flags: Array<Record<string, unknown>>;
  reason?: string;
}

export interface WorkspaceFeatureFlagsResult {
  directoryStatus: "available" | "unavailable";
  apps: FleetFlagApp[];
}

export interface WorkspaceFeatureFlagMutationResult {
  contractVersion: 1;
  status: "ready";
  key: string;
  rules: Record<string, unknown>;
  scope: { orgId: string | null };
}

export interface WorkspaceFeatureFlagMutationInput {
  appId: string;
  key: string;
  operation: "enable-for-current-user" | "off" | "replace-rules";
  rules?: Record<string, unknown>;
}

export function workspaceFeatureFlagTargetInput(
  input: WorkspaceFeatureFlagMutationInput,
): Omit<WorkspaceFeatureFlagMutationInput, "appId"> {
  const { appId: _appId, ...rawTargetInput } = input;
  return input.operation === "replace-rules" && input.rules
    ? {
        ...rawTargetInput,
        rules: {
          ...input.rules,
          emails: input.rules.emails ?? [],
          orgIds: input.rules.orgIds ?? [],
          percentage: input.rules.percentage ?? 0,
        },
      }
    : rawTargetInput;
}

export function validateWorkspaceFeatureFlagMutation(
  body: unknown,
  expected: {
    key: string;
    orgId: string;
    rules?: Record<string, unknown>;
    enabledForEmail?: string;
  },
): WorkspaceFeatureFlagMutationResult {
  const payload = body as Partial<WorkspaceFeatureFlagMutationResult> | null;
  const valid =
    payload?.contractVersion === 1 &&
    payload.status === "ready" &&
    payload.key === expected.key &&
    !!payload.rules &&
    typeof payload.rules === "object" &&
    !Array.isArray(payload.rules) &&
    !!payload.scope &&
    typeof payload.scope === "object" &&
    payload.scope.orgId === expected.orgId;
  if (!valid)
    throw new Error(
      "The target app returned an unsupported or unverified feature flag mutation response.",
    );
  const persistedRules = payload.rules as Record<string, unknown>;
  if (expected.rules) {
    for (const field of ["mode", "percentage", "rolloutEpoch"] as const) {
      if (
        expected.rules[field] !== undefined &&
        persistedRules[field] !== expected.rules[field]
      )
        throw new Error(
          "The target app did not persist the requested feature flag rules.",
        );
    }
    for (const field of ["emails", "orgIds"] as const) {
      const isValidTargetArray = (value: unknown): value is string[] =>
        Array.isArray(value) &&
        value.every(
          (item) => typeof item === "string" && item.trim().length > 0,
        );
      const normalize = (value: unknown) =>
        Array.isArray(value)
          ? [
              ...new Set(
                value
                  .filter((item): item is string => typeof item === "string")
                  .map((item) =>
                    field === "emails"
                      ? item.trim().toLowerCase()
                      : item.trim(),
                  )
                  .filter(Boolean),
              ),
            ].sort()
          : [];
      if (
        expected.rules[field] !== undefined &&
        (!isValidTargetArray(persistedRules[field]) ||
          JSON.stringify(normalize(persistedRules[field])) !==
            JSON.stringify(normalize(expected.rules[field])))
      )
        throw new Error(
          "The target app did not persist the requested feature flag rules.",
        );
    }
  }
  if (expected.enabledForEmail) {
    const email = expected.enabledForEmail.trim().toLowerCase();
    const emails = Array.isArray(persistedRules.emails)
      ? persistedRules.emails
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
      : [];
    if (persistedRules.mode !== "on" && !emails.includes(email))
      throw new Error(
        "The target app did not enable the feature flag for the delegated operator.",
      );
  }
  return payload as WorkspaceFeatureFlagMutationResult;
}

function targetOrigin(app: OrgApp): string {
  return new URL(app.url).origin;
}

async function delegatedToken(
  admin: AnalyticsAdminContext,
  origin: string,
  scope: "flags:read" | "flags:write",
): Promise<string> {
  return signA2AToken(admin.userEmail, undefined, undefined, {
    expiresIn: "120s",
    preferGlobalSecret: true,
    audience: origin,
    extraClaims: { org_id: admin.orgId, scope, jti: randomUUID() },
  });
}

async function callTarget(
  app: OrgApp,
  admin: AnalyticsAdminContext,
  action: "list-feature-flags" | "set-feature-flag",
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const origin = targetOrigin(app);
  const token = await delegatedToken(
    admin,
    origin,
    action === "list-feature-flags" ? "flags:read" : "flags:write",
  );
  const response = await fetch(`${origin}/_agent-native/actions/${action}`, {
    method: action === "list-feature-flags" ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(action === "set-feature-flag"
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(action === "set-feature-flag" ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TARGET_TIMEOUT_MS),
  });
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    // A legacy/non-action endpoint is classified below without reflecting body.
  }
  return { status: response.status, body: parsed };
}

export function classifyWorkspaceFeatureFlagList(
  app: OrgApp,
  result: { status: number; body: unknown },
): FleetFlagApp {
  const base = {
    appId: app.id,
    appName: app.name,
    appOrigin: targetOrigin(app),
    flags: [] as Array<Record<string, unknown>>,
  };
  if (result.status === 401 || result.status === 403)
    return { ...base, state: "forbidden" };
  if (result.status === 404 || result.status === 405)
    return { ...base, state: "unsupported" };
  if (result.status < 200 || result.status >= 300)
    return { ...base, state: "unknown-legacy" };
  const payload = result.body as {
    flags?: unknown;
    canManage?: unknown;
    status?: unknown;
    contractVersion?: unknown;
  } | null;
  if (!payload || !Array.isArray(payload.flags))
    return { ...base, state: "unknown-legacy" };
  if (payload.contractVersion !== 1)
    return { ...base, state: "unknown-legacy" };
  if (payload.status === "no-definitions")
    return { ...base, state: "no-definitions" };
  if (payload.status === "forbidden" || payload.canManage === false)
    return { ...base, state: "forbidden" };
  if (payload.flags.length === 0) return { ...base, state: "no-definitions" };
  return {
    ...base,
    state: "ready",
    flags: payload.flags.filter(
      (f): f is Record<string, unknown> => !!f && typeof f === "object",
    ),
  };
}

async function mapBounded<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

export async function listWorkspaceFeatureFlags(
  admin: AnalyticsAdminContext,
): Promise<WorkspaceFeatureFlagsResult> {
  const apps = await fetchOrgApps({ serviceOrgId: admin.orgId });
  if (apps.length === 0) return { directoryStatus: "unavailable", apps: [] };
  const entries = await mapBounded(apps, async (app) => {
    try {
      return classifyWorkspaceFeatureFlagList(
        app,
        await callTarget(app, admin, "list-feature-flags", {}),
      );
    } catch {
      return {
        appId: app.id,
        appName: app.name,
        appOrigin: targetOrigin(app),
        state: "unreachable" as const,
        flags: [],
      };
    }
  });
  return { directoryStatus: "available", apps: entries };
}

export async function setWorkspaceFeatureFlag(
  admin: AnalyticsAdminContext,
  input: WorkspaceFeatureFlagMutationInput,
): Promise<WorkspaceFeatureFlagMutationResult> {
  const apps = await fetchOrgApps({ serviceOrgId: admin.orgId });
  const app = apps.find((candidate) => candidate.id === input.appId);
  if (!app)
    throw new Error(
      "The requested app is not available in this organization directory.",
    );
  const targetInput = workspaceFeatureFlagTargetInput(input);
  const result = await callTarget(app, admin, "set-feature-flag", targetInput);
  if (result.status === 401 || result.status === 403)
    throw new Error("The target app denied this delegated flag operation.");
  if (result.status === 404 || result.status === 405)
    throw new Error("The target app does not support feature flag management.");
  if (result.status < 200 || result.status >= 300)
    throw new Error(
      "The target app could not persist the feature flag change.",
    );
  return validateWorkspaceFeatureFlagMutation(result.body, {
    key: input.key,
    orgId: admin.orgId,
    ...(input.operation === "replace-rules" && input.rules
      ? {
          rules: {
            mode: input.rules.mode,
            emails: input.rules.emails ?? [],
            orgIds: input.rules.orgIds ?? [],
            percentage: input.rules.percentage ?? 0,
            ...(input.rules.rolloutEpoch
              ? { rolloutEpoch: input.rules.rolloutEpoch }
              : {}),
          },
        }
      : input.operation === "off"
        ? {
            rules: {
              mode: "off",
              emails: [],
              orgIds: [],
              percentage: 0,
            },
          }
        : { enabledForEmail: admin.userEmail }),
  });
}

export async function getWorkspaceFlagTarget(
  admin: AnalyticsAdminContext,
  appId: string,
): Promise<FleetFlagApp> {
  const apps = await fetchOrgApps({ serviceOrgId: admin.orgId });
  const app = apps.find((candidate) => candidate.id === appId);
  if (!app)
    throw new Error(
      "The requested app is not available in this organization directory.",
    );
  try {
    return classifyWorkspaceFeatureFlagList(
      app,
      await callTarget(app, admin, "list-feature-flags", {}),
    );
  } catch {
    return {
      appId: app.id,
      appName: app.name,
      appOrigin: targetOrigin(app),
      state: "unreachable",
      flags: [],
    };
  }
}
