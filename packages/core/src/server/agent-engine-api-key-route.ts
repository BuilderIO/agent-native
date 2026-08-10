import {
  defineEventHandler,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";

import { normalizeOpenAiBaseUrl } from "../agent/engine/openai-compatible-endpoint.js";
import { validateProviderBaseUrl } from "../agent/engine/provider-endpoint-validation.js";
import {
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
  PROVIDER_ENV_META,
} from "../agent/engine/provider-env-vars.js";
import { getOrgContext } from "../org/context.js";
import { deleteAppSecret, writeAppSecret } from "../secrets/storage.js";
import { getSession } from "./auth.js";
import { clearProviderCredentialAuthFailure } from "./credential-provider.js";
import { readBody } from "./h3-helpers.js";

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

  const ctx = await getOrgContext(event).catch(() => null);
  if (!ctx?.orgId) {
    return { ok: false, statusCode: 400, error: "No active organization" };
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
    if (getMethod(event) !== "POST") {
      setResponseStatus(event, 405);
      return { error: "Method not allowed" };
    }

    const payload = normalizeAgentEngineApiKeyPayload(
      await readBody(event).catch(() => ({})),
    );
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

    if (payload.baseUrl) {
      try {
        await validateProviderBaseUrl(payload.baseUrl, {
          allowLocalOllama:
            payload.key === OLLAMA_BASE_URL_ENV_VAR &&
            process.env.NODE_ENV === "development",
        });
      } catch (err) {
        setResponseStatus(event, 400);
        return {
          error: err instanceof Error ? err.message : String(err),
        };
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
    };
  });
}
