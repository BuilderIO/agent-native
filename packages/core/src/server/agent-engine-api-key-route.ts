import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  normalizeOpenAiBaseUrl,
  stripOllamaV1Suffix,
} from "../agent/engine/openai-compatible-endpoint.js";
import { validateProviderBaseUrl } from "../agent/engine/provider-endpoint-validation.js";
import {
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
  PROVIDER_ENV_META,
} from "../agent/engine/provider-env-vars.js";
import { getOrgContext } from "../org/context.js";
import { secretKeyNames } from "../secrets/key-aliases.js";
import { deleteAppSecret, writeAppSecret } from "../secrets/storage.js";
import {
  readDefaultModelSelectionRequest,
  selectDefaultModelForSavedKey,
} from "./agent-engine-default-model-route.js";
import {
  checkProviderKeyForSave,
  providerForKeyEnvVar,
  type ProviderKeyCheckCode,
} from "./agent-engine-provider-models-route.js";
import { getSession } from "./auth.js";
import {
  clearProviderCredentialAuthFailure,
  isTrustedSelfHostedRuntime,
} from "./credential-provider.js";
import { readBody } from "./h3-helpers.js";
import {
  PERSONAL_PROVIDER_KEYS_RESTRICTED_ERROR_CODE,
  resolvePersonalProviderKeySaveDenial,
} from "./personal-provider-key-policy.js";
import { runWithRequestContext } from "./request-context.js";

const PROVIDER_TO_ENV_VAR = new Map(
  Object.entries(PROVIDER_ENV_META).map(([provider, meta]) => [
    provider,
    meta.envVar,
  ]),
);
const PROVIDER_ENV_VAR_KEYS = new Set(PROVIDER_TO_ENV_VAR.values());
const BASE_URL_KEYS = new Set([
  OPENAI_BASE_URL_ENV_VAR,
  OLLAMA_BASE_URL_ENV_VAR,
]);
const OPENAI_PROVIDER_KEY = PROVIDER_TO_ENV_VAR.get("openai") ?? "";

type AgentEngineApiKeyScope = "user" | "org";

export interface AgentEngineApiKeyWriteTarget {
  scope: AgentEngineApiKeyScope;
  scopeId: string;
}

/**
 * Check a provider key before it is stored, by listing the models it
 * reaches. `baseUrl` is OpenAI's gateway: a string checks that endpoint,
 * `null` the default, `undefined` the saved one (read through the ambient
 * request context).
 */
export async function validateAgentEngineProviderKey(
  key: string,
  value: string,
  options: { baseUrl?: string | null } = {},
): Promise<
  | { ok: true; models: string[] }
  | {
      ok: false;
      statusCode: number;
      error: string;
      code: ProviderKeyCheckCode;
    }
> {
  const provider = providerForKeyEnvVar(key);
  if (!provider) {
    throw new Error(`${key} is not a provider API key.`);
  }
  return checkProviderKeyForSave({
    provider,
    key: value,
    ...(provider === "openai" ? { baseUrl: options.baseUrl } : {}),
  });
}

export function normalizeAgentEngineApiKeyPayload(body: unknown):
  | {
      ok: true;
      key: string;
      value?: string;
      baseUrl?: string;
      clearBaseUrl: boolean;
      scope: AgentEngineApiKeyScope;
    }
  | { ok: false; statusCode: number; error: string } {
  const payload = body && typeof body === "object" ? body : {};
  const raw = payload as {
    key?: unknown;
    provider?: unknown;
    value?: unknown;
    apiKey?: unknown;
    baseUrl?: unknown;
    endpointUrl?: unknown;
    clearBaseUrl?: unknown;
    scope?: unknown;
  };

  const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
  const key =
    typeof raw.key === "string"
      ? raw.key.trim()
      : provider === "ollama"
        ? OLLAMA_BASE_URL_ENV_VAR
        : provider
          ? (PROVIDER_TO_ENV_VAR.get(provider) ?? "")
          : "";
  if (!key || (!PROVIDER_ENV_VAR_KEYS.has(key) && !BASE_URL_KEYS.has(key))) {
    return {
      ok: false,
      statusCode: 400,
      error: "Unsupported agent engine provider key.",
    };
  }

  const value =
    typeof raw.value === "string"
      ? raw.value.trim()
      : typeof raw.apiKey === "string"
        ? raw.apiKey.trim()
        : "";

  const rawBaseUrl =
    typeof raw.baseUrl === "string"
      ? raw.baseUrl
      : typeof raw.endpointUrl === "string"
        ? raw.endpointUrl
        : "";
  let baseUrl: string | undefined;
  if (rawBaseUrl.trim()) {
    if (key !== OPENAI_PROVIDER_KEY && !BASE_URL_KEYS.has(key)) {
      return {
        ok: false,
        statusCode: 400,
        error: "Endpoint URL is only supported for OpenAI or Ollama.",
      };
    }
    try {
      baseUrl = normalizeOpenAiBaseUrl(rawBaseUrl);
      if (key === OLLAMA_BASE_URL_ENV_VAR) {
        baseUrl = stripOllamaV1Suffix(baseUrl);
      }
    } catch (err) {
      return {
        ok: false,
        statusCode: 400,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const clearBaseUrl = raw.clearBaseUrl === true && baseUrl == null;
  if (clearBaseUrl && key !== OPENAI_PROVIDER_KEY && !BASE_URL_KEYS.has(key)) {
    return {
      ok: false,
      statusCode: 400,
      error: "Endpoint URL is only supported for OpenAI or Ollama.",
    };
  }

  if (!value && !baseUrl && !clearBaseUrl) {
    return {
      ok: false,
      statusCode: 400,
      error: "value or baseUrl is required",
    };
  }

  if (raw.scope != null && raw.scope !== "user" && raw.scope !== "org") {
    return {
      ok: false,
      statusCode: 400,
      error: 'scope must be "user" or "org"',
    };
  }

  return {
    ok: true,
    key,
    ...(value ? { value } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    clearBaseUrl,
    scope: raw.scope === "org" ? "org" : "user",
  };
}

export function normalizeAgentEngineApiKeyDeletePayload(body: unknown):
  | {
      ok: true;
      key: string;
      endpointKey?: string;
      scope: AgentEngineApiKeyScope;
    }
  | { ok: false; statusCode: number; error: string } {
  const raw = (body && typeof body === "object" ? body : {}) as {
    provider?: unknown;
    scope?: unknown;
  };
  const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
  const key =
    provider === "ollama"
      ? OLLAMA_BASE_URL_ENV_VAR
      : (PROVIDER_TO_ENV_VAR.get(provider) ?? "");
  if (!key) {
    return {
      ok: false,
      statusCode: 400,
      error: "Choose a supported agent engine provider.",
    };
  }
  if (raw.scope != null && raw.scope !== "user" && raw.scope !== "org") {
    return {
      ok: false,
      statusCode: 400,
      error: 'scope must be "user" or "org"',
    };
  }
  return {
    ok: true,
    key,
    ...(provider === "openai" ? { endpointKey: OPENAI_BASE_URL_ENV_VAR } : {}),
    scope: raw.scope === "org" ? "org" : "user",
  };
}

export async function resolveAgentEngineApiKeyWriteTarget(
  event: H3Event,
  scope: AgentEngineApiKeyScope,
): Promise<
  | { ok: true; target: AgentEngineApiKeyWriteTarget }
  | { ok: false; statusCode: number; error: string }
> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    return { ok: false, statusCode: 401, error: "Authentication required" };
  }

  if (scope === "user") {
    return {
      ok: true,
      target: { scope: "user", scopeId: session.email },
    };
  }

  // Not caught: an unreadable org context must not downgrade an admin's
  // organization save to a personal one that answers 200.
  const ctx = await getOrgContext(event);
  if (!ctx.orgId) {
    // Without an organization, the caller's own keys are the only keys.
    return {
      ok: true,
      target: { scope: "user", scopeId: session.email },
    };
  }
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return {
      ok: false,
      statusCode: 403,
      error: "Only organization owners and admins can set org-scoped keys",
    };
  }

  return {
    ok: true,
    target: { scope: "org", scopeId: ctx.orgId },
  };
}

export function createAgentEngineApiKeyHandler() {
  return defineEventHandler(async (event: H3Event) => {
    if (getMethod(event) === "DELETE") {
      let body: unknown;
      try {
        body = await readBody(event);
      } catch (error) {
        console.warn("[agent-engine] malformed delete payload", error);
        body = undefined;
      }
      const payload = normalizeAgentEngineApiKeyDeletePayload(body);
      if (!payload.ok) {
        setResponseStatus(event, payload.statusCode);
        return { error: payload.error };
      }
      const resolved = await resolveAgentEngineApiKeyWriteTarget(
        event,
        payload.scope,
      );
      if (!resolved.ok) {
        setResponseStatus(event, resolved.statusCode);
        return { error: resolved.error };
      }
      // A row saved under an older name of the same key would otherwise keep
      // the provider working after it was removed.
      for (const key of secretKeyNames(payload.key)) {
        await deleteAppSecret({ key, ...resolved.target });
      }
      if (payload.endpointKey) {
        await deleteAppSecret({
          key: payload.endpointKey,
          ...resolved.target,
        });
      }
      return { ok: true, key: payload.key, scope: resolved.target.scope };
    }

    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    // coercion-ok: an unreadable body normalizes to a 400 below, never a save.
    const body = await readBody(event).catch(() => ({}));
    const payload = normalizeAgentEngineApiKeyPayload(body);
    if (!payload.ok) {
      setResponseStatus(event, payload.statusCode);
      return { error: payload.error };
    }
    const defaultModelRequest = readDefaultModelSelectionRequest(body);
    if (!defaultModelRequest.ok) {
      setResponseStatus(event, 400);
      return { error: defaultModelRequest.error };
    }

    const resolved = await resolveAgentEngineApiKeyWriteTarget(
      event,
      payload.scope,
    );
    if (!resolved.ok) {
      setResponseStatus(event, resolved.statusCode);
      return { error: resolved.error };
    }
    // Removing a personal key stays allowed; only new personal saves stop.
    if (
      resolved.target.scope === "user" &&
      (payload.value || payload.baseUrl)
    ) {
      const denial = await resolvePersonalProviderKeySaveDenial(
        event,
        resolved.target.scopeId,
        payload.key,
      );
      if (denial) {
        setResponseStatus(event, 403);
        return {
          error: denial,
          errorCode: PERSONAL_PROVIDER_KEYS_RESTRICTED_ERROR_CODE,
        };
      }
    }

    if (payload.baseUrl) {
      try {
        await validateProviderBaseUrl(payload.baseUrl, {
          isOllama: payload.key === OLLAMA_BASE_URL_ENV_VAR,
          allowLocalOllama:
            payload.key === OLLAMA_BASE_URL_ENV_VAR &&
            isTrustedSelfHostedRuntime(),
        });
      } catch (err) {
        setResponseStatus(event, 400);
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    if (payload.value && PROVIDER_ENV_VAR_KEYS.has(payload.key)) {
      const value = payload.value;
      const baseUrl = payload.baseUrl
        ? payload.baseUrl
        : payload.clearBaseUrl
          ? null
          : undefined;
      // A key saved without an endpoint keeps the saved one, which the
      // runtime resolves across the caller's personal and org rows.
      const needsSavedEndpoint =
        payload.key === OPENAI_PROVIDER_KEY && baseUrl === undefined;
      const session = await getSession(event);
      const orgId =
        resolved.target.scope === "org"
          ? resolved.target.scopeId
          : needsSavedEndpoint
            ? ((await getOrgContext(event)).orgId ?? undefined)
            : undefined;
      const keyValidation = await runWithRequestContext(
        { userEmail: session?.email, orgId },
        () => validateAgentEngineProviderKey(payload.key, value, { baseUrl }),
      );
      if (!keyValidation.ok) {
        setResponseStatus(event, keyValidation.statusCode);
        return { error: keyValidation.error, code: keyValidation.code };
      }
    }

    if (payload.value) {
      await writeAppSecret({
        key: payload.key,
        value: payload.value,
        scope: resolved.target.scope,
        scopeId: resolved.target.scopeId,
      });
      await clearProviderCredentialAuthFailure({
        key: payload.key,
        value: payload.value,
      });
    }

    if (payload.baseUrl) {
      await writeAppSecret({
        key:
          payload.key === OLLAMA_BASE_URL_ENV_VAR
            ? OLLAMA_BASE_URL_ENV_VAR
            : OPENAI_BASE_URL_ENV_VAR,
        value: payload.baseUrl,
        scope: resolved.target.scope,
        scopeId: resolved.target.scopeId,
      });
    } else if (payload.clearBaseUrl) {
      await deleteAppSecret({
        key:
          payload.key === OLLAMA_BASE_URL_ENV_VAR
            ? OLLAMA_BASE_URL_ENV_VAR
            : OPENAI_BASE_URL_ENV_VAR,
        scope: resolved.target.scope,
        scopeId: resolved.target.scopeId,
      });
    }

    // Personal and organization rows for one provider coexist: an org save
    // never touches the caller's personal row, which the resolver keeps using
    // for them alone (user before org).
    const defaultModel = defaultModelRequest.request
      ? await selectDefaultModelForSavedKey(event, {
          keyScope: resolved.target.scope,
          keyScopeId: resolved.target.scopeId,
          request: defaultModelRequest.request,
        })
      : undefined;

    return {
      ok: true,
      key: payload.key,
      ...(payload.baseUrl || payload.clearBaseUrl
        ? {
            baseUrlKey:
              payload.key === OLLAMA_BASE_URL_ENV_VAR
                ? OLLAMA_BASE_URL_ENV_VAR
                : OPENAI_BASE_URL_ENV_VAR,
          }
        : {}),
      scope: resolved.target.scope,
      ...(defaultModel ? { defaultModel } : {}),
    };
  });
}
