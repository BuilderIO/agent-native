import {
  HOSTED_HARNESS_ENV_KEY,
  HOSTED_HARNESS_ORG_SETTING_KEY,
  isHostedHarnessConfigured,
  normalizeHostedHarnessRuntimes,
  type HostedHarnessRuntime,
} from "../agent/harness/hosted.js";
import type { AgentNativeHarnessSetting } from "../config.js";
import { getOrgSetting } from "../settings/org-settings.js";
import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
} from "../vite/agent-native-config-loader.js";
import { readHostedHarnessBuildConfig } from "./hosted-harness-build-mode.js";

export interface HostedHarnessPolicy {
  enabled: boolean;
  configEnabled: boolean;
  envEnabled: boolean;
  organizationEnabled: boolean;
  runtimes: HostedHarnessRuntime[];
}

export function isHostedHarnessEnvEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env[HOSTED_HARNESS_ENV_KEY]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export async function loadHostedHarnessConfig(
  cwd = process.cwd(),
): Promise<AgentNativeHarnessSetting | undefined> {
  const build = readHostedHarnessBuildConfig();
  if (build.recorded) return build.value;

  // Not embedded: an older bundle, or a build that skipped the Vite/deploy
  // config hook. Fall back to the disk read, which only succeeds when the
  // config file is actually present (dev server, `agent-native start` from
  // the app directory) — a deployed function ships neither config file.
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
  config?: AgentNativeHarnessSetting;
  orgId?: string | null;
  userEmail?: string | null;
}): Promise<HostedHarnessPolicy> {
  const config = options.config ?? (await loadHostedHarnessConfig());
  const organizationSetting = options.orgId
    ? await getOrgSetting(options.orgId, HOSTED_HARNESS_ORG_SETTING_KEY)
    : null;
  const envEnabled = isHostedHarnessEnvEnabled();
  // The deployment flag is the fleet-level default. An org setting is only
  // needed when a deployment has not enabled the hosted harness globally.
  const organizationEnabled =
    envEnabled || organizationSetting?.enabled === true;
  const configEnabled = isHostedHarnessConfigured(config);
  return {
    enabled: configEnabled && (envEnabled || organizationEnabled),
    configEnabled,
    envEnabled,
    organizationEnabled,
    runtimes: normalizeHostedHarnessRuntimes(
      typeof config === "object" && config !== null
        ? config.runtimes
        : undefined,
    ),
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
