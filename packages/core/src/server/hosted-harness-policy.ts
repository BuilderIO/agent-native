import type { AgentNativeConfig, AgentNativeHarnessConfig } from "../config.js";
import {
  HOSTED_HARNESS_ENV_KEY,
  HOSTED_HARNESS_FEATURE_FLAG,
  normalizeHostedHarnessRuntimes,
  resolveHostedHarnessUi,
  type HostedHarnessRuntime,
} from "../agent/harness/hosted.js";
import { evaluateFeatureFlag } from "../feature-flags/store.js";
import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
} from "../vite/agent-native-config-loader.js";

export interface HostedHarnessPolicy {
  enabled: boolean;
  configEnabled: boolean;
  envEnabled: boolean;
  organizationEnabled: boolean;
  runtimes: HostedHarnessRuntime[];
  ui: "default" | "desktop";
}

export function isHostedHarnessEnvEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env[HOSTED_HARNESS_ENV_KEY]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export async function loadHostedHarnessConfig(
  cwd = process.cwd(),
): Promise<AgentNativeHarnessConfig | undefined> {
  const production = process.env.NODE_ENV === "production";
  const config = await loadResolvedAgentNativeConfig(
    cwd,
    createAgentNativeConfigContext(
      production ? "build" : "serve",
      production ? "production" : "development",
    ),
  );
  return config.harness;
}

export async function resolveHostedHarnessPolicy(options: {
  config?: AgentNativeHarnessConfig;
  orgId?: string | null;
  userEmail?: string | null;
}): Promise<HostedHarnessPolicy> {
  const config = options.config ?? (await loadHostedHarnessConfig());
  const organizationEnabled = await evaluateFeatureFlag(
    HOSTED_HARNESS_FEATURE_FLAG,
    {
      userEmail: options.userEmail ?? undefined,
      orgId: options.orgId ?? null,
    },
  ).catch(() => false);
  const envEnabled = isHostedHarnessEnvEnabled();
  const configEnabled = config?.enabled === true;
  return {
    enabled: configEnabled && (envEnabled || organizationEnabled),
    configEnabled,
    envEnabled,
    organizationEnabled,
    runtimes: normalizeHostedHarnessRuntimes(config?.runtimes),
    ui: resolveHostedHarnessUi(config),
  };
}

export function hostedHarnessStatusForClient(
  policy: HostedHarnessPolicy,
): HostedHarnessPolicy {
  return {
    ...policy,
    runtimes: [...policy.runtimes],
  };
}

export function resetHostedHarnessConfigCacheForTests(): void {
  // Kept as a no-op seam for callers that previously cached config in tests.
}

export type { AgentNativeConfig };
