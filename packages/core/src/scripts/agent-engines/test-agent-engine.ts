/**
 * test-agent-engine — sends a trivial prompt to verify the engine is working.
 */

import { createProviderEndpointFetch } from "../../agent/engine/ai-sdk-engine.js";
import {
  getAgentEngineEntry,
  registerBuiltinEngines,
  type AgentEngineEntry,
} from "../../agent/engine/index.js";
import {
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
} from "../../agent/engine/openai-compatible-endpoint.js";
import {
  isLocalNetworkOllamaEndpoint,
  validateProviderBaseUrl,
} from "../../agent/engine/provider-endpoint-validation.js";
import type { ActionTool } from "../../agent/types.js";
import {
  assertCredentialCanReachEndpoint,
  type CredentialEndpointOwner,
} from "../../credentials/index.js";
import { isBlockedExtensionUrlWithDns } from "../../extensions/url-safety.js";
import {
  assertCredentialStoreReadable,
  canUseDeployCredentialFallbackForRequest,
  isTrustedSelfHostedRuntime,
  readDeployCredentialEnv,
  resolveSecretDetailed,
} from "../../server/credential-provider.js";
import { getRequestUserEmail } from "../../server/request-context.js";

export const tool: ActionTool = {
  description:
    "Test an agent engine by sending a trivial prompt and measuring latency. Useful for verifying API keys and connectivity before switching engines.",
  parameters: {
    type: "object",
    properties: {
      engine: {
        type: "string",
        description:
          'Engine name to test (e.g. "anthropic", "ai-sdk:openai"). Defaults to "anthropic".',
      },
      model: {
        type: "string",
        description:
          "Model to use for the test. Defaults to the engine's default model.",
      },
      baseUrl: {
        type: "string",
        description:
          'Optional OpenAI-compatible endpoint URL to test with "ai-sdk:openai". Uses the saved endpoint when omitted.',
      },
    },
    required: [],
  },
};

interface ResolvedEngineSecret {
  value: string;
  owner: CredentialEndpointOwner;
}

interface ResolvedEngineEndpoint {
  baseUrl: string;
  owner: CredentialEndpointOwner;
}

function secretOwner(
  detail: Awaited<ReturnType<typeof resolveSecretDetailed>>,
): CredentialEndpointOwner {
  return {
    scope:
      detail.source === "env" ? "deployment" : (detail.source ?? "unknown"),
    ...(detail.scopeId ? { scopeId: detail.scopeId } : {}),
  };
}

async function resolveAgentEngineSecret(
  key: string,
): Promise<ResolvedEngineSecret | undefined> {
  const resolved = await resolveSecretDetailed(key);
  if (resolved.value) {
    return { value: resolved.value, owner: secretOwner(resolved) };
  }
  assertCredentialStoreReadable(resolved);
  if (!canUseDeployCredentialFallbackForRequest(key)) return undefined;
  const value = readDeployCredentialEnv(key);
  return value ? { value, owner: { scope: "deployment" } } : undefined;
}

async function resolveAgentEngineEndpoint(
  key: string,
): Promise<ResolvedEngineEndpoint | undefined> {
  const isOllama = key === OLLAMA_BASE_URL_ENV_VAR;
  const resolved = await resolveSecretDetailed(key);
  if (!resolved.value) {
    assertCredentialStoreReadable(resolved);
    if (!canUseDeployCredentialFallbackForRequest(key)) return undefined;
  }
  const endpointValue = resolved.value ?? readDeployCredentialEnv(key);
  if (!endpointValue) return undefined;
  const owner = resolved.value
    ? secretOwner(resolved)
    : { scope: "deployment" };
  return {
    baseUrl: await validateProviderBaseUrl(endpointValue, {
      allowPrivate: owner.scope === "deployment",
      allowLocalOllama: isOllama && isTrustedSelfHostedRuntime(),
      isOllama,
    }),
    owner,
  };
}

function canUseDeployEnvForEntry(entry: AgentEngineEntry): boolean {
  if (entry.requiredEnvVars.length === 0) return true;
  return entry.requiredEnvVars.every((key) =>
    canUseDeployCredentialFallbackForRequest(key),
  );
}

async function createEngineConfig(
  entry: AgentEngineEntry,
  args: Record<string, string>,
): Promise<Record<string, unknown>> {
  const key = entry.requiredEnvVars[0];
  const resolvedKey = key ? await resolveAgentEngineSecret(key) : undefined;
  const config: Record<string, unknown> = {
    apiKey: resolvedKey?.value,
    allowEnvFallback: canUseDeployEnvForEntry(entry),
  };

  if (entry.name === "ai-sdk:openai" || entry.name === "ai-sdk:ollama") {
    const isOllama = entry.name === "ai-sdk:ollama";
    const endpointKey = isOllama
      ? OLLAMA_BASE_URL_ENV_VAR
      : OPENAI_BASE_URL_ENV_VAR;
    const explicitBaseUrl = args.baseUrl?.trim();
    const email = getRequestUserEmail();
    const endpoint: ResolvedEngineEndpoint | undefined = explicitBaseUrl
      ? {
          baseUrl: await validateProviderBaseUrl(explicitBaseUrl, {
            allowLocalOllama: isOllama && isTrustedSelfHostedRuntime(),
            isOllama,
          }),
          owner: { scope: "user", ...(email ? { scopeId: email } : {}) },
        }
      : await resolveAgentEngineEndpoint(endpointKey);
    if (endpoint) {
      if (key && resolvedKey) {
        assertCredentialCanReachEndpoint(
          endpoint.owner,
          resolvedKey.owner,
          key,
        );
      }
      if (endpoint.owner.scope !== "deployment") {
        config.allowEnvFallback = false;
      }
      config.baseUrl = endpoint.baseUrl;
      const allowLocalOllama =
        isOllama &&
        isTrustedSelfHostedRuntime() &&
        isLocalNetworkOllamaEndpoint(endpoint.baseUrl);
      const allowedPrivateOrigin =
        (endpoint.owner.scope === "deployment" || allowLocalOllama) &&
        (await isBlockedExtensionUrlWithDns(endpoint.baseUrl))
          ? new URL(endpoint.baseUrl).origin
          : undefined;
      config.requestFetch = createProviderEndpointFetch(
        endpoint.baseUrl,
        allowedPrivateOrigin ? [allowedPrivateOrigin] : [],
      );
    } else if (isOllama) {
      const allowedPrivateOrigins =
        isTrustedSelfHostedRuntime() &&
        isLocalNetworkOllamaEndpoint(OLLAMA_DEFAULT_BASE_URL)
          ? [new URL(OLLAMA_DEFAULT_BASE_URL).origin]
          : [];
      config.requestFetch = createProviderEndpointFetch(
        OLLAMA_DEFAULT_BASE_URL,
        allowedPrivateOrigins,
      );
    }
  }

  return config;
}

export async function run(args: Record<string, string>): Promise<string> {
  registerBuiltinEngines();

  const engineName = args.engine ?? "anthropic";
  const entry = getAgentEngineEntry(engineName);
  if (!entry) {
    return JSON.stringify({
      ok: false,
      error: `Engine "${engineName}" not found`,
    });
  }

  const model = args.model ?? entry.defaultModel;

  try {
    const engine = entry.create(await createEngineConfig(entry, args));

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let responseText = "";
    let stopReason = "";

    let streamError: string | undefined;

    try {
      for await (const event of engine.stream({
        model,
        systemPrompt: "You are a test agent. Reply concisely.",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Reply with exactly: OK" }],
          },
        ],
        tools: [],
        abortSignal: controller.signal,
      })) {
        if (event.type === "text-delta") {
          responseText += event.text;
        } else if (event.type === "stop") {
          stopReason = event.reason;
          if (event.reason === "error") {
            streamError = (event as any).error ?? "Unknown error";
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - start;

    if (streamError) {
      return JSON.stringify({
        ok: false,
        engine: engineName,
        model,
        error: streamError,
        capabilities: entry.capabilities,
      });
    }

    return JSON.stringify({
      ok: true,
      engine: engineName,
      model,
      latencyMs,
      response: responseText.slice(0, 100),
      stopReason,
      capabilities: entry.capabilities,
    });
  } catch (err: any) {
    return JSON.stringify({
      ok: false,
      engine: engineName,
      model,
      error: err?.message ?? String(err),
      capabilities: entry.capabilities,
    });
  }
}
