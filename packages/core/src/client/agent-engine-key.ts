/**
 * Agent engine API-key helpers (browser).
 *
 * Named client helper for storing a bring-your-own provider key (Anthropic,
 * OpenAI, etc.) so the agent chat can run without a Builder connection or an
 * account. The key is persisted by the framework under the matching provider
 * key (e.g. ANTHROPIC_API_KEY) at the scope the caller picks: personal by
 * default, or the active organization's for owners and admins, exactly like
 * the LLM settings panel does - UI code should call this instead of
 * hand-writing a fetch to framework routes.
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

/**
 * Where a provider key is stored. `"user"` is the caller's personal key;
 * `"org"` is the active organization's (owners and admins only). A caller
 * with no organization always saves personally.
 */
export type AgentEngineKeyScope = "user" | "org";

export interface SaveAgentEngineApiKeyOptions {
  provider?: AgentEngineProvider;
  key?: string;
  apiKey: string;
  /** Defaults to `"user"`. */
  scope?: AgentEngineKeyScope;
}

export interface SaveAgentEngineProviderSettingsOptions {
  provider?: AgentEngineProvider;
  key?: string;
  apiKey?: string;
  baseUrl?: string;
  clearBaseUrl?: boolean;
  /** Defaults to `"user"`. Pass `"org"` only when the caller chose Organization. */
  scope?: AgentEngineKeyScope;
  /**
   * Also make this provider the default model in the same save when the
   * caller may change it (owners and admins; a user with no organization).
   * Otherwise only the key is saved. `engine` defaults to the provider's.
   */
  defaultModel?: { engine?: string; model?: string };
}

export interface SavedAgentEngineSelection {
  engine: string;
  model: string;
}

/**
 * What a key save did to the default model. `skipped` means only the key was
 * saved: the caller can't change the default, or saved a personal key.
 */
export type AgentEngineDefaultModelOutcome =
  | { status: "selected"; engine: string; model: string }
  | { status: "skipped"; reason: "not-allowed" | "personal-key" }
  | { status: "failed"; error: string };

export interface SaveAgentEngineProviderSettingsResult {
  /** Present only when `defaultModel` was requested. */
  defaultModel?: AgentEngineDefaultModelOutcome;
}

export interface AgentEngineProviderKeyStatus {
  /** `"invalid"`: the provider rejected the key in effect (see `rejectedAt`). */
  status: "set" | "unset" | "invalid" | "unknown";
  /** When the provider last rejected the key in effect (ms). */
  rejectedAt?: number;
  effectiveScope?: "user" | "org" | "workspace" | "env";
  overriddenScope?: "org" | "workspace";
  personalKeyPresent: boolean;
  organizationKeyPresent: boolean;
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

export async function getAgentEngineProviderKeyStatus(
  provider: AgentEngineProvider,
): Promise<AgentEngineProviderKeyStatus> {
  const option = getAgentProviderOption(provider);
  const key = option.key ?? option.endpointKey;
  if (!key) {
    throw new Error("This provider does not use a stored key.");
  }
  const response = await fetch(agentNativePath("/_agent-native/secrets"), {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Could not load key status (HTTP ${response.status}).`);
  }
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Could not read provider key status.");
  }
  const secret = payload.find(
    (item): item is Record<string, unknown> =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).key === key,
  );
  if (
    !secret ||
    !["set", "unset", "invalid", "unknown"].includes(String(secret.status))
  ) {
    throw new Error("Could not read this provider's key status.");
  }
  const effectiveScope = ["user", "org", "workspace", "env"].includes(
    String(secret.effectiveScope),
  )
    ? (secret.effectiveScope as AgentEngineProviderKeyStatus["effectiveScope"])
    : undefined;
  const overriddenScope = ["org", "workspace"].includes(
    String(secret.overriddenScope),
  )
    ? (secret.overriddenScope as AgentEngineProviderKeyStatus["overriddenScope"])
    : undefined;
  return {
    status: secret.status as AgentEngineProviderKeyStatus["status"],
    ...(secret.status === "invalid" && typeof secret.rejectedAt === "number"
      ? { rejectedAt: secret.rejectedAt }
      : {}),
    ...(effectiveScope ? { effectiveScope } : {}),
    ...(overriddenScope ? { overriddenScope } : {}),
    personalKeyPresent: effectiveScope === "user",
    organizationKeyPresent:
      effectiveScope === "org" || overriddenScope === "org",
  };
}

export async function deleteAgentEnginePersonalProviderSettings(
  provider: AgentEngineProvider,
): Promise<void> {
  await deleteAgentEngineProviderSettings({ provider });
}

/**
 * Remove a provider's stored key (and OpenAI's endpoint override) at one
 * scope. Removing an organization key needs owner or admin; the server
 * refuses anyone else.
 */
export async function deleteAgentEngineProviderSettings({
  provider,
  scope,
}: {
  provider: AgentEngineProvider;
  /** Defaults to `"user"`. */
  scope?: AgentEngineKeyScope;
}): Promise<void> {
  const response = await fetch(
    agentNativePath("/_agent-native/agent-engine/api-key"),
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ provider, ...(scope ? { scope } : {}) }),
    },
  );
  if (!response.ok) {
    const message = await readProviderSettingsError(response);
    throw new Error(
      message ??
        (scope === "org"
          ? `Could not remove the organization key (HTTP ${response.status}).`
          : `Could not remove your personal key (HTTP ${response.status}).`),
    );
  }
  dispatchConfiguredChanged();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeAgentEngineSelectionPayload(
  value: unknown,
  fallbackMessage: string,
  depth = 0,
): Record<string, unknown> {
  if (depth > 3) {
    throw new Error(fallbackMessage);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(fallbackMessage);
    }
    if (/^(Error|Warning):/i.test(trimmed)) {
      throw new Error(trimmed);
    }
    try {
      return decodeAgentEngineSelectionPayload(
        JSON.parse(trimmed) as unknown,
        fallbackMessage,
        depth + 1,
      );
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(fallbackMessage);
      }
      throw error;
    }
  }

  if (!isRecord(value)) {
    throw new Error(fallbackMessage);
  }

  if (Object.hasOwn(value, "error")) {
    const error = value.error;
    throw new Error(
      typeof error === "string" && error.trim()
        ? error.trim()
        : fallbackMessage,
    );
  }
  if (Object.hasOwn(value, "warning")) {
    const warning = value.warning;
    throw new Error(
      typeof warning === "string" && warning.trim()
        ? warning.trim()
        : fallbackMessage,
    );
  }
  if (Object.hasOwn(value, "ok") && value.ok !== true) {
    throw new Error(fallbackMessage);
  }
  if (Object.hasOwn(value, "result")) {
    return decodeAgentEngineSelectionPayload(
      value.result,
      fallbackMessage,
      depth + 1,
    );
  }
  return value;
}

async function readProviderSettingsError(
  response: Response,
): Promise<string | undefined> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  try {
    const body = JSON.parse(trimmed) as unknown;
    if (body !== null && typeof body === "object") {
      const error = (body as { error?: unknown }).error;
      if (typeof error === "string" && error.trim()) {
        return error.trim();
      }
    } else if (typeof body === "string" && body.trim()) {
      return body.trim();
    }
    return undefined;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // Plain-text relay errors are the useful fallback for desktop requests.
  }

  return trimmed.startsWith("<") ? undefined : trimmed.slice(0, 500);
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
  defaultModel,
}: SaveAgentEngineProviderSettingsOptions): Promise<SaveAgentEngineProviderSettingsResult> {
  const trimmed = apiKey?.trim() ?? "";
  const endpoint = baseUrl?.trim() ?? "";
  if (!trimmed && !endpoint && !clearBaseUrl) {
    throw new Error("Enter an API key or endpoint URL first.");
  }
  const envVar = resolveProviderEnvVar(provider, key);
  const defaultModelEngine = defaultModel
    ? defaultModel.engine?.trim() ||
      (provider ? getAgentProviderOption(provider).engine : "")
    : "";
  if (defaultModel && !defaultModelEngine) {
    throw new Error("Choose a provider first.");
  }
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
        scope: scope ?? "user",
        ...(defaultModel
          ? {
              defaultModel: {
                engine: defaultModelEngine,
                ...(defaultModel.model?.trim()
                  ? { model: defaultModel.model.trim() }
                  : {}),
              },
            }
          : {}),
      }),
    },
  );
  if (!res.ok) {
    const message = await readProviderSettingsError(res);
    throw new Error(
      message ??
        (res.status === 401
          ? "Sign in to save a key, or connect Builder with a free tier instead."
          : `Could not save provider settings (HTTP ${res.status}).`),
    );
  }
  let outcome: AgentEngineDefaultModelOutcome | undefined;
  if (defaultModel) {
    // coercion-ok: an unreadable body decodes to "failed", never a selection.
    outcome = decodeDefaultModelOutcome(await res.json().catch(() => null));
  }
  dispatchConfiguredChanged();
  return outcome ? { defaultModel: outcome } : {};
}

function decodeDefaultModelOutcome(
  body: unknown,
): AgentEngineDefaultModelOutcome {
  const raw = isRecord(body) ? body.defaultModel : undefined;
  if (isRecord(raw)) {
    if (
      raw.status === "selected" &&
      typeof raw.engine === "string" &&
      typeof raw.model === "string"
    ) {
      return { status: "selected", engine: raw.engine, model: raw.model };
    }
    if (
      raw.status === "skipped" &&
      (raw.reason === "not-allowed" || raw.reason === "personal-key")
    ) {
      return { status: "skipped", reason: raw.reason };
    }
    if (raw.status === "failed" && typeof raw.error === "string") {
      return { status: "failed", error: raw.error };
    }
  }
  // The key saved, but the answer about the default is unreadable; say so
  // instead of reporting it as selected or skipped.
  return {
    status: "failed",
    error: "The key was saved, but the default model could not be confirmed.",
  };
}

/**
 * List the models an Ollama server actually has installed, via its native
 * `/api/tags` endpoint. Pass `baseUrl` to check a server before it's saved
 * (e.g. while the user is still typing the endpoint); omit it to use the
 * saved endpoint. Throws a readable Error if the server can't be reached.
 */
export async function fetchOllamaModels(baseUrl?: string): Promise<string[]> {
  const trimmed = baseUrl?.trim() ?? "";
  const path = trimmed
    ? `/_agent-native/agent-engine/ollama-models?baseUrl=${encodeURIComponent(trimmed)}`
    : "/_agent-native/agent-engine/ollama-models";
  const response = await fetch(agentNativePath(path), {
    credentials: "include",
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text.trim() ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(
      `Could not read the Ollama models response (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Could not list Ollama models (HTTP ${response.status}).`;
    throw new Error(message);
  }
  const models =
    payload && typeof payload === "object"
      ? (payload as { models?: unknown }).models
      : undefined;
  return Array.isArray(models)
    ? models.filter((model): model is string => typeof model === "string")
    : [];
}

export type ProviderModelsCheckCode =
  | "rejected"
  | "wrong-provider"
  | "missing-key"
  | "invalid-endpoint"
  | "unreachable"
  | "provider-error";

/**
 * A provider's answer about a key. `ok: false` is a verdict (the key or
 * endpoint didn't work), not a transport failure; those throw.
 */
export type ProviderModelsCheck =
  | {
      ok: true;
      provider: AgentEngineProvider;
      models: string[];
      /** More models existed than one check reads. */
      truncated?: boolean;
      checkedAt: number;
    }
  | {
      ok: false;
      provider: AgentEngineProvider;
      models: [];
      code: ProviderModelsCheckCode;
      /** English reason; localize from `code` and the fields below. */
      reason: string;
      status?: number;
      expectedPrefix?: string;
      detectedProvider?: AgentEngineProvider;
      checkedAt: number;
    };

export interface FetchProviderModelsOptions {
  provider: AgentEngineProvider;
  /** A pasted key. Omit to check the saved key. */
  key?: string;
  /**
   * OpenAI-compatible gateway or Ollama endpoint. Omit to use the saved one.
   * Needs `key` (except for Ollama): a saved key is only checked against its
   * saved endpoint, and the server answers 400 otherwise.
   */
  baseUrl?: string;
  /** Which saved key to check when `key` is omitted. `org` is owners/admins. */
  scope?: AgentEngineKeyScope;
}

const PROVIDER_MODELS_CHECK_CODES: readonly ProviderModelsCheckCode[] = [
  "rejected",
  "wrong-provider",
  "missing-key",
  "invalid-endpoint",
  "unreachable",
  "provider-error",
];

function decodeProviderModelsCheck(
  body: unknown,
  provider: AgentEngineProvider,
): ProviderModelsCheck | null {
  if (!isRecord(body) || typeof body.checkedAt !== "number") return null;
  if (body.ok === true && Array.isArray(body.models)) {
    return {
      ok: true,
      provider,
      models: body.models.filter(
        (model): model is string => typeof model === "string",
      ),
      ...(body.truncated === true ? { truncated: true } : {}),
      checkedAt: body.checkedAt,
    };
  }
  if (
    body.ok === false &&
    typeof body.reason === "string" &&
    PROVIDER_MODELS_CHECK_CODES.includes(body.code as ProviderModelsCheckCode)
  ) {
    return {
      ok: false,
      provider,
      models: [],
      code: body.code as ProviderModelsCheckCode,
      reason: body.reason,
      ...(typeof body.status === "number" ? { status: body.status } : {}),
      ...(typeof body.expectedPrefix === "string"
        ? { expectedPrefix: body.expectedPrefix }
        : {}),
      ...(typeof body.detectedProvider === "string"
        ? { detectedProvider: body.detectedProvider as AgentEngineProvider }
        : {}),
      checkedAt: body.checkedAt,
    };
  }
  return null;
}

/**
 * Check a provider key by asking the provider which models it reaches. The
 * same list fills the model checklist. Omit `key` to check the saved key
 * ("Check again"). Resolves with the provider's verdict, including
 * rejections; throws a readable Error only when the check itself couldn't run
 * (signed out, malformed request, server unreachable).
 */
export async function fetchProviderModels({
  provider,
  key,
  baseUrl,
  scope,
}: FetchProviderModelsOptions): Promise<ProviderModelsCheck> {
  const trimmedKey = key?.trim() ?? "";
  const trimmedBaseUrl = baseUrl?.trim() ?? "";
  const response = await fetch(
    agentNativePath("/_agent-native/agent-engine/provider-models"),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        ...(trimmedKey ? { key: trimmedKey } : {}),
        ...(trimmedBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
        ...(scope ? { scope } : {}),
      }),
    },
  );
  // coercion-ok: an unreadable body falls through to the errors below.
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : `Could not check this key (HTTP ${response.status}).`,
    );
  }
  const check = decodeProviderModelsCheck(body, provider);
  if (!check) {
    throw new Error("Could not read the key check response.");
  }
  return check;
}

/**
 * Make a provider and model the default model (the organization's, or a
 * no-organization user's own). Only owners and admins may change an
 * organization's default; for anyone else this throws the server's refusal.
 * To save a key and select its provider in one step, pass `defaultModel` to
 * {@link saveAgentEngineProviderSettings} instead.
 */
export async function setAgentEngineProvider({
  provider,
  model,
}: {
  provider: AgentEngineProvider;
  model?: string;
}): Promise<SavedAgentEngineSelection> {
  const option = getAgentProviderOption(provider);
  return setAgentEngineDefaultModel({
    engine: option.engine,
    model,
    label: option.label,
  });
}

/**
 * {@link setAgentEngineProvider} for any engine, Builder.io included. Throws
 * the server's refusal for anyone who may not change the default.
 */
export async function setAgentEngineDefaultModel({
  engine,
  model,
  label = engine,
}: {
  engine: string;
  model?: string;
  /** Names the engine in the fallback error. */
  label?: string;
}): Promise<SavedAgentEngineSelection> {
  const res = await fetch(
    agentNativePath("/_agent-native/actions/manage-agent-engine"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set",
        engine,
        ...(model?.trim() ? { model: model.trim() } : {}),
      }),
    },
  );
  const fallbackMessage = `Could not select ${label}.`;
  const text = await res.text();
  const body = decodeAgentEngineSelectionPayload(text, fallbackMessage);
  if (!res.ok) {
    throw new Error(fallbackMessage);
  }

  const savedEngine = body.engine;
  const savedModel = body.model;
  if (
    body.ok !== true ||
    savedEngine !== engine ||
    typeof savedModel !== "string" ||
    !savedModel.trim()
  ) {
    throw new Error(fallbackMessage);
  }
  dispatchConfiguredChanged();
  return { engine: savedEngine, model: savedModel.trim() };
}
