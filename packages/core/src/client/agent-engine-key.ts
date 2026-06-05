/**
 * Agent engine API-key helpers (browser).
 *
 * Named client helper for storing a bring-your-own provider key (Anthropic,
 * OpenAI, etc.) so the agent chat can run without a Builder connection or an
 * account. The key is persisted by the framework under the matching provider
 * env var (e.g. ANTHROPIC_API_KEY) for the current owner, exactly like the
 * LLM settings panel does — UI code should call this instead of hand-writing
 * a fetch to the framework env-vars route.
 */

import { agentNativePath } from "./api-path.js";

/** Providers that can be configured with a single pasted API key. */
export type AgentEngineProvider = "anthropic" | "openai";

const PROVIDER_ENV_VAR: Record<AgentEngineProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** Event other parts of the agent UI listen for to re-check the LLM gate. */
const CONFIGURED_CHANGED_EVENT = "agent-engine:configured-changed";

export interface SaveAgentEngineApiKeyOptions {
  provider: AgentEngineProvider;
  apiKey: string;
}

/**
 * Persist a provider API key for the current owner. Resolves on success.
 * Throws an Error with a readable message on failure. On success it also
 * dispatches `agent-engine:configured-changed` so any open agent chat flips
 * out of its "needs setup" state without a reload.
 */
export async function saveAgentEngineApiKey({
  provider,
  apiKey,
}: SaveAgentEngineApiKeyOptions): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("Enter an API key first.");
  }
  const envVar = PROVIDER_ENV_VAR[provider];
  const res = await fetch(agentNativePath("/_agent-native/env-vars"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vars: [{ key: envVar, value: trimmed }] }),
  });
  if (!res.ok) {
    const message = await res
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => null);
    throw new Error(
      message ??
        (res.status === 401
          ? "Sign in to save a key, or connect Builder instead."
          : `Could not save the key (HTTP ${res.status}).`),
    );
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CONFIGURED_CHANGED_EVENT));
  }
}
