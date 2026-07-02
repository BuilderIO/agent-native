/**
 * test-agent-engine — sends a trivial prompt to verify the engine is working.
 */

import {
  getAgentEngineEntry,
  registerBuiltinEngines,
  type AgentEngineEntry,
} from "../../agent/engine/index.js";
import {
  normalizeOpenAiBaseUrl,
  OPENAI_BASE_URL_ENV_VAR,
} from "../../agent/engine/openai-compatible-endpoint.js";
import type { ActionTool } from "../../agent/types.js";
import {
  canUseDeployCredentialFallbackForRequest,
  readDeployCredentialEnv,
  resolveSecret,
} from "../../server/credential-provider.js";

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

async function resolveAgentEngineSecret(
  key: string,
): Promise<string | undefined> {
  try {
    const value = await resolveSecret(key);
    if (value) return value;
  } catch {
    // Fall through to deploy env when this request is allowed to use it.
  }
  return canUseDeployCredentialFallbackForRequest()
    ? readDeployCredentialEnv(key)
    : undefined;
}

async function createEngineConfig(
  entry: AgentEngineEntry,
  args: Record<string, string>,
): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = {
    apiKey:
      entry.requiredEnvVars.length > 0
        ? await resolveAgentEngineSecret(entry.requiredEnvVars[0])
        : undefined,
    allowEnvFallback: canUseDeployCredentialFallbackForRequest(),
  };

  if (entry.name === "ai-sdk:openai") {
    const rawBaseUrl = args.baseUrl?.trim()
      ? args.baseUrl
      : await resolveAgentEngineSecret(OPENAI_BASE_URL_ENV_VAR);
    if (rawBaseUrl) {
      config.baseUrl = normalizeOpenAiBaseUrl(rawBaseUrl);
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
