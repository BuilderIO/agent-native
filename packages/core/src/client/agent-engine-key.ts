/**
 * Agent engine API-key helpers (browser).
 *
 * Named client helper for storing a bring-your-own provider key (Anthropic,
 * OpenAI, etc.) so the agent chat can run without a Builder connection or an
 * account. The key is persisted by the framework under the matching provider
 * key (e.g. ANTHROPIC_API_KEY) for the current user or org, exactly like the
 * LLM settings panel does — UI code should call this instead of hand-writing
 * a fetch to framework routes.
 */

import {
  OLLAMA_BASE_URL_ENV_VAR,
  PROVIDER_ENV_META,
} from "../agent/engine/provider-env-vars.js";
import {
  getAgentProviderOption,
  type AgentProviderId,
} from "./agent-provider-catalog.js";
import { agentNativePath } from "./api-path.js";

/** Providers that can be configured with a single pasted API key. */
export type AgentEngineProvider = AgentProviderId;

const PROVIDER_ENV_VAR: Partial<Record<AgentEngineProvider, string>> = {
  ...Object.fromEntries(
    Object.entries(PROVIDER_ENV_META).map(([provider, meta]) => [
      provider,
      meta.envVar,
    ]),
  ),
  ollama: OLLAMA_BASE_URL_ENV_VAR,
};

/** Event other parts of the agent UI listen for to re-check the LLM gate. */
const CONFIGURED_CHANGED_EVENT = "agent-engine:configured-changed";

export interface SaveAgentEngineApiKeyOptions {
  provider?: AgentEngineProvider;
  key?: string;
  apiKey: string;
  scope?: "user" | "org";
}

export interface SaveAgentEngineProviderSettingsOptions {
  provider?: AgentEngineProvider;
  key?: string;
  apiKey?: string;
  baseUrl?: string;
  clearBaseUrl?: boolean;
  scope?: "user" | "org";
}

function resolveProviderEnvVar(
  provider: AgentEngineProvider | undefined,
  key: string | undefined,
): string {
  const envVar = key?.trim() || (provider ? PROVIDER_ENV_VAR[provider] : "");
  if (!envVar) {
    throw new Error("Choose an API key provider first.");
  }
  return envVar;
}

function dispatchConfiguredChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CONFIGURED_CHANGED_EVENT));
  }
}

/**
 * Persist a provider API key for the current owner. Resolves on success.
 * Throws an Error with a readable message on failure. On success it also
 * dispatches `agent-engine:configured-changed` so any open agent chat flips
 * out of its "needs setup" state without a reload.
 */
export async function saveAgentEngineApiKey({
  provider,
  key,
  apiKey,
  scope,
}: SaveAgentEngineApiKeyOptions): Promise<void> {
  if (!apiKey.trim()) {
    throw new Error("Enter an API key first.");
  }
  await saveAgentEngineProviderSettings({ provider, key, apiKey, scope });
}

/**
 * Persist provider-specific settings for the current owner. This covers
 * built-in BYOK provider keys plus optional OpenAI-compatible and Ollama
 * endpoint URLs. Values are stored server-side in scoped secrets.
 */
export async function saveAgentEngineProviderSettings({
  provider,
  key,
  apiKey,
  baseUrl,
  clearBaseUrl,
  scope,
}: SaveAgentEngineProviderSettingsOptions): Promise<void> {
  const trimmed = apiKey?.trim() ?? "";
  const endpoint = baseUrl?.trim() ?? "";
  if (!trimmed && !endpoint && !clearBaseUrl) {
    throw new Error("Enter an API key or endpoint URL first.");
  }
  const envVar = resolveProviderEnvVar(provider, key);
  const res = await fetch(
    agentNativePath("/_agent-native/agent-engine/api-key"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: envVar,
        ...(trimmed ? { value: trimmed } : {}),
        ...(endpoint ? { baseUrl: endpoint } : {}),
        ...(clearBaseUrl ? { clearBaseUrl: true } : {}),
        scope,
      }),
    },
  );
  if (!res.ok) {
    const message = await res
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => null);
    throw new Error(
      message ??
        (res.status === 401
          ? "Sign in to save a key, or connect Builder with a free tier instead."
          : `Could not save provider settings (HTTP ${res.status}).`),
    );
  }
  dispatchConfiguredChanged();
}

/**
 * Select the provider and model for the next conversation. This is separate
 * from saving credentials so keyless local providers such as Ollama can use
 * the same setup surface as API-key providers.
 */
export async function setAgentEngineProvider({
  provider,
  model,
}: {
  provider: AgentEngineProvider;
  model?: string;
}): Promise<void> {
  const option = getAgentProviderOption(provider);
  const res = await fetch(
    agentNativePath("/_agent-native/actions/manage-agent-engine"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set",
        engine: option.engine,
        ...(model?.trim() ? { model: model.trim() } : {}),
      }),
    },
  );
  if (!res.ok) {
    const message = await res
      .json()
      .then((body: { error?: string; result?: unknown }) =>
        typeof body?.error === "string"
          ? body.error
          : typeof body?.result === "string"
            ? body.result
            : undefined,
      )
      .catch(() => undefined);
    throw new Error(message ?? `Could not select ${option.label}.`);
  }
  const body = await res
    .json()
    .catch(() => null as { error?: string; result?: unknown } | null);
  const actionResult = body?.result;
  if (
    typeof body?.error === "string" ||
    (typeof actionResult === "string" &&
      /^(Error|Warning):/i.test(actionResult))
  ) {
    throw new Error(
      body.error ??
        (typeof actionResult === "string"
          ? actionResult
          : `Could not select ${option.label}.`),
    );
  }
  dispatchConfiguredChanged();
}
