import { getAppConfig } from "../app-config/index.js";
import { getRequestContext } from "../server/request-context.js";
import { DEFAULT_MODEL } from "./default-model.js";
import {
  getAgentEngineEntry,
  isAgentEngineSettingConfigured,
  normalizeModelForEngine,
} from "./engine/registry.js";

export function normalizeAgentEngineStatusModel(
  entry:
    | { name: string; defaultModel: string; supportedModels: readonly string[] }
    | undefined,
  model: string | null | undefined,
): string {
  if (!entry) return model ?? DEFAULT_MODEL;
  return normalizeModelForEngine(entry, model ?? entry.defaultModel);
}

type AgentEngineStatusEntry = {
  name: string;
  defaultModel: string;
  supportedModels: readonly string[];
  requiredEnvVars: readonly string[];
};

export interface AgentEngineStatusResult {
  configured: boolean;
  engine?: string;
  model?: string;
  source?: "settings" | "env" | "app_secrets" | "app-default";
  selectionSource?:
    | "configuration"
    | "app-default"
    | "shared-default"
    | "app_secrets"
    | "env";
  envVar?: string;
  openAiBaseUrlConfigured?: boolean;
}

export interface AgentEngineStatusResponse extends AgentEngineStatusResult {
  /** Fast chat setup snapshot; dispatch rechecks credentials before model use. */
  chatEligible: boolean;
}

export interface AgentEngineStatusDeps<
  E extends AgentEngineStatusEntry = AgentEngineStatusEntry,
> {
  readStoredEngine: () => Promise<{ engine?: string; model?: string } | null>;
  readAppDefault?: () => Promise<{ engine: string; model: string } | null>;
  readOpenAiBaseUrlConfigured: () => boolean | Promise<boolean>;
  isStoredEngineUsable: (
    stored: unknown,
    entry: E,
  ) => boolean | Promise<boolean>;
  detectFromUserSecrets: () => Promise<E | null>;
  detectFromEnv: () => E | null | Promise<E | null>;
  lookupEntry?: (engine: string) => E | undefined;
}

/**
 * Resolve "does this request have a usable AI provider" for one identity.
 *
 * Every call site pays for these lookups on a user-visible path (the agent
 * composer blocks on the status probe), so the two identity-independent reads
 * start together and the expensive `app_secrets` sweep only runs when the
 * cheaper sources have not already answered.
 */
export async function resolveAgentEngineStatus<
  E extends AgentEngineStatusEntry,
>(deps: AgentEngineStatusDeps<E>): Promise<AgentEngineStatusResult> {
  const lookupEntry = (deps.lookupEntry ?? getAgentEngineEntry) as (
    engine: string,
  ) => E | undefined;
  const [stored, openAiBaseUrlConfigured, appDefault] = await Promise.all([
    deps.readStoredEngine(),
    deps.readOpenAiBaseUrlConfigured(),
    deps.readAppDefault?.(),
  ]);

  const configuredEngine = getAppConfig().agent.engine;
  const configuredModel =
    getAppConfig().agent.model === "auto"
      ? undefined
      : getAppConfig().agent.model;
  const envEntry = configuredEngine ? lookupEntry(configuredEngine) : undefined;
  if (envEntry) {
    if (await deps.isStoredEngineUsable({ engine: envEntry.name }, envEntry)) {
      return {
        configured: true,
        engine: envEntry.name,
        model: normalizeAgentEngineStatusModel(
          envEntry,
          configuredModel ??
            (appDefault?.engine === envEntry.name
              ? appDefault.model
              : stored?.engine === envEntry.name
                ? stored.model
                : undefined),
        ),
        source: "env",
        selectionSource: "configuration",
        envVar: "AGENT_ENGINE",
        openAiBaseUrlConfigured,
      };
    }
    if (getRequestContext()?.isSyntheticTraffic !== true) {
      return {
        configured: false,
        selectionSource: "configuration",
        openAiBaseUrlConfigured,
      };
    }
  }

  if (appDefault) {
    const entry = lookupEntry(appDefault.engine);
    if (entry && (await deps.isStoredEngineUsable(appDefault, entry))) {
      return {
        configured: true,
        engine: appDefault.engine,
        model: normalizeAgentEngineStatusModel(
          entry,
          configuredModel ?? appDefault.model,
        ),
        source: "app-default",
        selectionSource: configuredModel ? "configuration" : "app-default",
        openAiBaseUrlConfigured,
      };
    }
  }

  // Stored provider selections win over an existing Builder connection, so
  // this is checked before the app_secrets sweep — and the sweep is skipped
  // entirely when it answers.
  if (stored && typeof stored.engine === "string") {
    const entry = lookupEntry(stored.engine);
    if (entry && (await deps.isStoredEngineUsable(stored, entry))) {
      return {
        configured: true,
        engine: stored.engine,
        model: normalizeAgentEngineStatusModel(
          entry,
          configuredModel ?? stored.model,
        ),
        source: isAgentEngineSettingConfigured(stored) ? "settings" : "env",
        selectionSource: configuredModel ? "configuration" : "shared-default",
        envVar: entry.requiredEnvVars[0],
        openAiBaseUrlConfigured,
      };
    }
  }

  // Per-user app_secrets — a user who connected Builder (or pasted their own
  // provider key) may not have any deploy-level env vars set.
  const detectedFromUser = await deps.detectFromUserSecrets();
  if (detectedFromUser) {
    return {
      configured: true,
      engine: detectedFromUser.name,
      model: normalizeAgentEngineStatusModel(detectedFromUser, configuredModel),
      source: "app_secrets",
      selectionSource: configuredModel ? "configuration" : "app_secrets",
      envVar: detectedFromUser.requiredEnvVars[0],
      openAiBaseUrlConfigured,
    };
  }

  const detected = await deps.detectFromEnv();
  if (detected) {
    return {
      configured: true,
      engine: detected.name,
      model: normalizeAgentEngineStatusModel(detected, configuredModel),
      source: "env",
      selectionSource: configuredModel ? "configuration" : "env",
      envVar: detected.requiredEnvVars[0],
      openAiBaseUrlConfigured,
    };
  }

  return { configured: false, openAiBaseUrlConfigured };
}
