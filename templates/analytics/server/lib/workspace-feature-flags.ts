import { randomUUID } from "node:crypto";

import { signA2AToken } from "@agent-native/core/a2a";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import { fetchOrgApps, type OrgApp } from "@agent-native/core/mcp";
import { getOrgDomain } from "@agent-native/core/org";

import { VERIFIED_FLEET_FLAG_MUTATIONS } from "../../shared/feature-flags.js";
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

export interface VerifiedWorkspaceFeatureFlagMutationResult {
  contractVersion: 3;
  status: "verified";
  key: string;
  rules: Record<string, unknown>;
  scope: { orgId: string | null; orgDomain: string | null };
  enabledForCurrentUser: boolean;
}

interface TargetFeatureFlagMutationResult {
  contractVersion: 2;
  status: "ready";
  key: string;
  rules: Record<string, unknown>;
  scope: { orgId: string | null; orgDomain: string | null };
}

export type WorkspaceFeatureFlagMutationResult =
  | TargetFeatureFlagMutationResult
  | VerifiedWorkspaceFeatureFlagMutationResult;

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
    orgDomain: string;
    allowExplicitNoOrgTarget?: boolean;
    rules?: Record<string, unknown>;
    enabledForEmail?: string;
  },
): TargetFeatureFlagMutationResult {
  const payload = body as Partial<TargetFeatureFlagMutationResult> | null;
  const valid =
    payload?.contractVersion === 2 &&
    payload.status === "ready" &&
    payload.key === expected.key &&
    !!payload.rules &&
    typeof payload.rules === "object" &&
    !Array.isArray(payload.rules) &&
    !!payload.scope &&
    typeof payload.scope === "object" &&
    (payload.scope.orgDomain === expected.orgDomain ||
      (expected.allowExplicitNoOrgTarget && payload.scope.orgDomain === null));
  if (!valid)
    throw new Error(
      "The target app returned an unsupported or unverified feature flag mutation response.",
    );
  const persistedRules = payload.rules as Record<string, unknown>;
  if (expected.rules) {
    for (const field of ["mode", "percentage"] as const) {
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
  return payload as TargetFeatureFlagMutationResult;
}

function targetOrigin(app: OrgApp): string {
  return new URL(app.url).origin;
}

async function delegatedToken(
  admin: AnalyticsAdminContext,
  origin: string,
  scope: "flags:read" | "flags:write",
  resolvedOrgDomain?: string,
): Promise<string> {
  try {
    const orgDomain =
      resolvedOrgDomain ??
      (await getOrgDomain(admin.orgId))?.trim().toLowerCase();
    if (!orgDomain) throw new TargetCallFailure("token-generation");
    return await signA2AToken(admin.userEmail, orgDomain, undefined, {
      expiresIn: "120s",
      preferGlobalSecret: true,
      audience: origin,
      extraClaims: { org_id: admin.orgId, scope, jti: randomUUID() },
    });
  } catch {
    throw new TargetCallFailure("token-generation");
  }
}

export type WorkspaceFeatureFlagFailurePhase =
  | "directory"
  | "token-generation"
  | "timeout"
  | "network"
  | "authorization"
  | "unsupported-target"
  | "target-action"
  | "persistence"
  | "verification";

const FAILURE_MESSAGES: Record<WorkspaceFeatureFlagFailurePhase, string> = {
  directory: "The organization app directory could not resolve this target.",
  "token-generation":
    "Analytics could not create delegated feature flag authority.",
  timeout: "The target app timed out before the feature flag change completed.",
  network: "Analytics could not reach the target app.",
  authorization: "The target app denied this delegated flag operation.",
  "unsupported-target":
    "The target app does not support feature flag management.",
  "target-action": "The target app could not complete the feature flag action.",
  persistence:
    "The target app did not persist the requested feature flag rules.",
  verification: "Analytics could not verify the persisted feature flag change.",
};

export class WorkspaceFeatureFlagFailure extends Error {
  constructor(readonly phase: WorkspaceFeatureFlagFailurePhase) {
    super(`[${phase}] ${FAILURE_MESSAGES[phase]}`);
    this.name = "WorkspaceFeatureFlagFailure";
  }
}

type TargetFailureReason = "token-generation" | "timeout" | "network";

class TargetCallFailure extends Error {
  constructor(readonly reason: TargetFailureReason) {
    super(`Feature flag target call failed: ${reason}`);
    this.name = "TargetCallFailure";
  }
}

export function classifyWorkspaceFeatureFlagTargetFailure(
  error: unknown,
): TargetFailureReason {
  if (error instanceof TargetCallFailure) return error.reason;
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  )
    return "timeout";
  return "network";
}

function targetFailure(error: unknown): WorkspaceFeatureFlagFailure {
  const reason = classifyWorkspaceFeatureFlagTargetFailure(error);
  return new WorkspaceFeatureFlagFailure(reason);
}

async function resolveTargetApp(
  admin: AnalyticsAdminContext,
  appId: string,
): Promise<OrgApp> {
  let apps: OrgApp[];
  try {
    apps = await fetchOrgApps({
      selfId: "analytics",
      includeDirectoryApp: true,
      serviceOrgId: admin.orgId,
    });
  } catch {
    throw new WorkspaceFeatureFlagFailure("directory");
  }
  const app = apps.find((candidate) => candidate.id === appId);
  if (!app) throw new WorkspaceFeatureFlagFailure("directory");
  return app;
}

async function callTarget(
  app: OrgApp,
  admin: AnalyticsAdminContext,
  action: "list-feature-flags" | "set-feature-flag",
  body: Record<string, unknown>,
  orgDomain?: string,
): Promise<{ status: number; body: unknown }> {
  const origin = targetOrigin(app);
  const token = await delegatedToken(
    admin,
    origin,
    action === "list-feature-flags" ? "flags:read" : "flags:write",
    orgDomain,
  );
  let response: Response;
  try {
    response = await fetch(`${origin}/_agent-native/actions/${action}`, {
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
  } catch (error) {
    throw new TargetCallFailure(
      classifyWorkspaceFeatureFlagTargetFailure(error),
    );
  }
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
    return { ...base, state: "unknown-legacy", reason: "target-execution" };
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
  const apps = await fetchOrgApps({
    selfId: "analytics",
    includeDirectoryApp: true,
    serviceOrgId: admin.orgId,
  });
  if (apps.length === 0) return { directoryStatus: "unavailable", apps: [] };
  const entries = await mapBounded(apps, async (app) => {
    try {
      return classifyWorkspaceFeatureFlagList(
        app,
        await callTarget(app, admin, "list-feature-flags", {}),
      );
    } catch (error) {
      return {
        appId: app.id,
        appName: app.name,
        appOrigin: targetOrigin(app),
        state: "unreachable" as const,
        flags: [],
        reason: classifyWorkspaceFeatureFlagTargetFailure(error),
      };
    }
  });
  return { directoryStatus: "available", apps: entries };
}

export async function setWorkspaceFeatureFlag(
  admin: AnalyticsAdminContext,
  input: WorkspaceFeatureFlagMutationInput,
): Promise<WorkspaceFeatureFlagMutationResult> {
  const app = await resolveTargetApp(admin, input.appId);
  const targetInput = workspaceFeatureFlagTargetInput(input);
  let orgDomain: string | undefined;
  try {
    orgDomain = (await getOrgDomain(admin.orgId))?.trim().toLowerCase();
  } catch {
    throw new WorkspaceFeatureFlagFailure("token-generation");
  }
  if (!orgDomain) throw new WorkspaceFeatureFlagFailure("token-generation");
  let result: Awaited<ReturnType<typeof callTarget>>;
  try {
    result = await callTarget(
      app,
      admin,
      "set-feature-flag",
      targetInput,
      orgDomain,
    );
  } catch (error) {
    throw targetFailure(error);
  }
  if (result.status === 401 || result.status === 403)
    throw new WorkspaceFeatureFlagFailure("authorization");
  if (result.status === 404 || result.status === 405)
    throw new WorkspaceFeatureFlagFailure("unsupported-target");
  if (result.status < 200 || result.status >= 300)
    throw new WorkspaceFeatureFlagFailure("target-action");
  let mutation: TargetFeatureFlagMutationResult;
  try {
    mutation = validateWorkspaceFeatureFlagMutation(result.body, {
      key: input.key,
      orgDomain,
      allowExplicitNoOrgTarget: true,
      ...(input.operation === "replace-rules" && input.rules
        ? {
            rules: {
              mode: input.rules.mode,
              emails: input.rules.emails ?? [],
              orgIds: input.rules.orgIds ?? [],
              percentage: input.rules.percentage ?? 0,
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
  } catch {
    throw new WorkspaceFeatureFlagFailure("persistence");
  }

  if (
    !(await isFeatureFlagEnabled(VERIFIED_FLEET_FLAG_MUTATIONS, {
      userEmail: admin.userEmail,
      userKey: admin.userEmail,
      orgId: admin.orgId,
    }))
  ) {
    return mutation;
  }

  let readBack: Awaited<ReturnType<typeof callTarget>>;
  try {
    readBack = await callTarget(
      app,
      admin,
      "list-feature-flags",
      {},
      orgDomain,
    );
  } catch (error) {
    throw targetFailure(error);
  }
  if (readBack.status === 401 || readBack.status === 403)
    throw new WorkspaceFeatureFlagFailure("authorization");
  if (readBack.status === 404 || readBack.status === 405)
    throw new WorkspaceFeatureFlagFailure("unsupported-target");
  if (readBack.status < 200 || readBack.status >= 300)
    throw new WorkspaceFeatureFlagFailure("verification");
  const verifiedApp = classifyWorkspaceFeatureFlagList(app, readBack);
  if (verifiedApp.state === "forbidden")
    throw new WorkspaceFeatureFlagFailure("authorization");
  if (verifiedApp.state === "unsupported")
    throw new WorkspaceFeatureFlagFailure("unsupported-target");
  const verifiedFlag = verifiedApp.flags.find((flag) => flag.key === input.key);
  const expectedEnabled =
    input.operation === "enable-for-current-user"
      ? true
      : input.operation === "off"
        ? false
        : null;
  if (
    verifiedApp.state !== "ready" ||
    !verifiedFlag ||
    typeof verifiedFlag.enabledForCurrentUser !== "boolean" ||
    (expectedEnabled !== null &&
      verifiedFlag.enabledForCurrentUser !== expectedEnabled)
  ) {
    throw new WorkspaceFeatureFlagFailure("verification");
  }
  try {
    validateWorkspaceFeatureFlagMutation(
      {
        contractVersion: 2,
        status: "ready",
        key: input.key,
        rules: verifiedFlag.rules,
        scope: mutation.scope,
      },
      {
        key: input.key,
        orgDomain,
        allowExplicitNoOrgTarget: true,
        rules: mutation.rules,
      },
    );
  } catch {
    throw new WorkspaceFeatureFlagFailure("verification");
  }
  return {
    contractVersion: 3,
    status: "verified",
    key: mutation.key,
    rules: verifiedFlag.rules as Record<string, unknown>,
    scope: mutation.scope,
    enabledForCurrentUser: verifiedFlag.enabledForCurrentUser,
  };
}

export async function getWorkspaceFlagTarget(
  admin: AnalyticsAdminContext,
  appId: string,
): Promise<FleetFlagApp> {
  const apps = await fetchOrgApps({
    selfId: "analytics",
    includeDirectoryApp: true,
    serviceOrgId: admin.orgId,
  });
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
  } catch (error) {
    return {
      appId: app.id,
      appName: app.name,
      appOrigin: targetOrigin(app),
      state: "unreachable",
      flags: [],
      reason: classifyWorkspaceFeatureFlagTargetFailure(error),
    };
  }
}
