/**
 * Which engines have a configurable provider base URL, which key configures
 * each one, and what shape that one configured value has to take for the
 * client the engine actually uses.
 *
 * Keep this table the single place an engine gains base-URL support: the
 * registry reads it, so adding a row here is the whole change.
 */

import { OPENAI_BASE_URL_ENV_VAR } from "./openai-compatible-endpoint.js";

export const ANTHROPIC_BASE_URL_ENV_VAR = "ANTHROPIC_BASE_URL";

/**
 * The two Anthropic clients disagree about what a base URL is. The official
 * `@anthropic-ai/sdk` appends `/v1/messages`, so it wants a bare origin — which
 * is also what `ANTHROPIC_BASE_URL` means everywhere else in the ecosystem.
 * `@ai-sdk/anthropic` appends only `/messages`, so it wants the version segment
 * included. One configured value has to drive both, so each engine declares
 * which form it needs and `baseUrlForEngine` converts either input to it;
 * otherwise the same gateway URL 404s on whichever of the two the app happens
 * to have selected.
 */
type BaseUrlShape = "as-configured" | "without-v1" | "with-v1";

interface EngineBaseUrlConfig {
  envVar: string;
  shape: BaseUrlShape;
}

const ENGINE_BASE_URLS: Readonly<Record<string, EngineBaseUrlConfig>> = {
  "ai-sdk:openai": {
    envVar: OPENAI_BASE_URL_ENV_VAR,
    shape: "as-configured",
  },
  anthropic: { envVar: ANTHROPIC_BASE_URL_ENV_VAR, shape: "without-v1" },
  "ai-sdk:anthropic": { envVar: ANTHROPIC_BASE_URL_ENV_VAR, shape: "with-v1" },
};

/**
 * Same endpoints as {@link ENGINE_BASE_URLS}, reached by the provider API key
 * they are configured alongside — the settings surface writes a provider's key
 * and its endpoint together and never names an engine.
 */
const API_KEY_TO_BASE_URL_ENV_VAR: Readonly<Record<string, string>> = {
  OPENAI_API_KEY: OPENAI_BASE_URL_ENV_VAR,
  ANTHROPIC_API_KEY: ANTHROPIC_BASE_URL_ENV_VAR,
};

/**
 * The secret/env key that configures this engine's base URL, or undefined for
 * engines that have no configurable endpoint.
 */
export function baseUrlEnvVarForEngine(engineName: string): string | undefined {
  return ENGINE_BASE_URLS[engineName]?.envVar;
}

/**
 * The endpoint key configurable alongside this provider API key, or undefined
 * for providers whose endpoint is not configurable.
 */
export function baseUrlEnvVarForApiKey(
  apiKeyEnvVar: string,
): string | undefined {
  return API_KEY_TO_BASE_URL_ENV_VAR[apiKeyEnvVar];
}

/** A configured base URL in the form this engine's client expects. */
export function baseUrlForEngine(
  engineName: string,
  configuredBaseUrl: string,
): string {
  const shape = ENGINE_BASE_URLS[engineName]?.shape ?? "as-configured";
  const trimmed = configuredBaseUrl.replace(/\/+$/, "");
  if (shape === "without-v1") return trimmed.replace(/\/v1$/, "");
  if (shape === "with-v1") {
    return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
  }
  return trimmed;
}
