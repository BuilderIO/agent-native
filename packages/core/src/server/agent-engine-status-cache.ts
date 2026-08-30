import {
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
  PROVIDER_ENV_VARS,
} from "../agent/engine/provider-env-vars.js";

export interface AgentEngineStatusResult {
  configured: boolean;
  engine?: string;
  model?: string;
  source?: "settings" | "env" | "app_secrets";
  envVar?: string;
  openAiBaseUrlConfigured?: boolean;
}

const agentEngineStatusInFlight = new Map<
  string,
  Promise<AgentEngineStatusResult>
>();

const AGENT_ENGINE_STATUS_CREDENTIAL_KEYS = new Set([
  ...PROVIDER_ENV_VARS,
  OPENAI_BASE_URL_ENV_VAR,
  OLLAMA_BASE_URL_ENV_VAR,
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
]);

/**
 * Share concurrent status probes, but let credential mutations discard an
 * older answer before the next probe joins it.
 */
export function shareAgentEngineStatusLookup(
  identityKey: string,
  compute: () => Promise<AgentEngineStatusResult>,
): Promise<AgentEngineStatusResult> {
  const existing = agentEngineStatusInFlight.get(identityKey);
  if (existing) return existing;
  const started = compute().finally(() => {
    if (agentEngineStatusInFlight.get(identityKey) === started) {
      agentEngineStatusInFlight.delete(identityKey);
    }
  });
  agentEngineStatusInFlight.set(identityKey, started);
  return started;
}

/** Drop in-flight answers that predate a provider/settings mutation. */
export function invalidateAgentEngineStatusLookups(): void {
  agentEngineStatusInFlight.clear();
}

export function isAgentEngineStatusCredentialKey(key: string): boolean {
  return AGENT_ENGINE_STATUS_CREDENTIAL_KEYS.has(key);
}

export function agentEngineStatusIdentityKey(
  userEmail: string | undefined,
  orgId: string | undefined,
): string {
  return `${userEmail ?? ""}\u0000${orgId ?? ""}`;
}
