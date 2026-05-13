export const WORKSPACE_APP_AUDIENCES = ["internal", "public"] as const;

export type WorkspaceAppAudience = (typeof WORKSPACE_APP_AUDIENCES)[number];

export const DEFAULT_WORKSPACE_APP_AUDIENCE: WorkspaceAppAudience = "internal";

export function normalizeWorkspaceAppAudience(
  value: unknown,
): WorkspaceAppAudience {
  return value === "public" ? "public" : DEFAULT_WORKSPACE_APP_AUDIENCE;
}

export function workspaceAppAudienceFromEnv(
  env?: Record<string, string | undefined>,
): WorkspaceAppAudience | undefined {
  const source = env ?? (typeof process !== "undefined" ? process.env : {});
  const raw =
    source.AGENT_NATIVE_WORKSPACE_APP_AUDIENCE ??
    source.VITE_AGENT_NATIVE_WORKSPACE_APP_AUDIENCE;
  if (raw === undefined) return undefined;
  return normalizeWorkspaceAppAudience(raw);
}

export function workspaceAppAudienceFromPackageJson(
  pkg: unknown,
): WorkspaceAppAudience | undefined {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return undefined;
  const record = pkg as Record<string, any>;
  const config = record["agent-native"] ?? record.agentNative;
  const nested =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, any>)
      : {};
  const raw =
    nested.workspaceApp?.audience ??
    nested.workspace?.audience ??
    nested.audience ??
    record.workspaceAppAudience;
  if (raw === undefined) return undefined;
  return normalizeWorkspaceAppAudience(raw);
}
