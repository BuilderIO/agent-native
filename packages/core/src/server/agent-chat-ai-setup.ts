import { createError } from "h3";

import {
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
  PROVIDER_ENV_VARS,
} from "../agent/engine/provider-env-vars.js";
import {
  assertCredentialStoreReadable,
  getProviderCredentialAuthFailure,
  prefetchSecrets,
  resolveHasBuilderGatewayCredential,
  resolveSecretDetailed,
} from "./credential-provider.js";

export const AGENT_CHAT_AI_SETUP_REQUIRED_CODE =
  "AGENT_CHAT_AI_SETUP_REQUIRED" as const;

/**
 * Chat accepts the Builder gateway/OAuth lane, a usable BYOK API key, or a
 * configured OpenAI-compatible/Ollama endpoint. Engine selection by itself is
 * not readiness: ChatGPT subscription auth and untyped engine names do not
 * qualify.
 */
export async function isAgentChatAiSetupReady(): Promise<boolean> {
  if (await resolveHasBuilderGatewayCredential()) return true;

  const customEndpointKeys = [
    OPENAI_BASE_URL_ENV_VAR,
    OLLAMA_BASE_URL_ENV_VAR,
  ] as const;
  await prefetchSecrets([...PROVIDER_ENV_VARS, ...customEndpointKeys]);
  for (const key of PROVIDER_ENV_VARS) {
    const resolved = await resolveSecretDetailed(key);
    const value = resolved.value?.trim();
    if (
      !value ||
      (resolved.source !== "user" &&
        resolved.source !== "org" &&
        resolved.source !== "workspace" &&
        resolved.source !== "env")
    ) {
      if (resolved.lookupFailed) {
        assertCredentialStoreReadable(resolved);
        throw createError({
          statusCode: 503,
          statusMessage:
            "Could not read saved AI connections. Try again shortly.",
        });
      }
      continue;
    }

    // `resolveSecretDetailed` only returns source `env` after applying the
    // request's deploy-credential fallback policy. This keeps local and
    // self-hosted setup working while hosted workspace provider env keys stay
    // unavailable to tenant users.
    if (!(await getProviderCredentialAuthFailure({ key, value }))) return true;

    if (resolved.lookupFailed) {
      assertCredentialStoreReadable(resolved);
      throw createError({
        statusCode: 503,
        statusMessage:
          "Could not read saved AI connections. Try again shortly.",
      });
    }
  }

  for (const key of customEndpointKeys) {
    const resolved = await resolveSecretDetailed(key);
    if (resolved.lookupFailed) {
      assertCredentialStoreReadable(resolved);
      throw createError({
        statusCode: 503,
        statusMessage:
          "Could not read saved AI connections. Try again shortly.",
      });
    }
    if (
      resolved.value?.trim() &&
      (resolved.source === "user" ||
        resolved.source === "org" ||
        resolved.source === "workspace" ||
        resolved.source === "env")
    ) {
      return true;
    }
  }

  return false;
}

export function isAgentChatAiSetupRequiredError(
  error: unknown,
): error is { statusMessage?: string; message?: string } {
  const data = (error as { data?: { code?: unknown } } | null | undefined)
    ?.data;
  return data?.code === AGENT_CHAT_AI_SETUP_REQUIRED_CODE;
}

export async function requireAgentChatAiSetup(): Promise<void> {
  if (await isAgentChatAiSetupReady()) return;

  throw createError({
    statusCode: 403,
    statusMessage: "Use Builder.io or a provider API key before chatting.",
    data: { code: AGENT_CHAT_AI_SETUP_REQUIRED_CODE },
  });
}

/**
 * Queue edits that only remove unchanged messages remain available so a user
 * can clear work after disconnecting AI. Adds, edits, malformed entries, and
 * reordering are chat input and require the same setup as a direct send.
 */
export function queuedMessagesNeedAgentChatAiSetup(
  existingThreadData: string,
  incomingMessages: unknown[],
): boolean {
  let existingMessages: unknown[] = [];
  try {
    const parsed = JSON.parse(existingThreadData);
    if (Array.isArray(parsed?.queuedMessages)) {
      existingMessages = parsed.queuedMessages;
    }
  } catch {
    // coercion-ok: malformed queues fail closed and still require AI setup.
    // An unreadable old queue cannot prove an incoming item is only a removal.
  }

  let previousIndex = -1;
  for (const incoming of incomingMessages) {
    if (
      !incoming ||
      typeof incoming !== "object" ||
      Array.isArray(incoming) ||
      typeof (incoming as { id?: unknown }).id !== "string"
    ) {
      return true;
    }

    const incomingId = (incoming as { id: string }).id;
    const matchIndex = existingMessages.findIndex(
      (candidate, index) =>
        index > previousIndex &&
        candidate !== null &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        (candidate as { id?: unknown }).id === incomingId,
    );
    if (matchIndex < 0) return true;

    if (stableJson(existingMessages[matchIndex]) !== stableJson(incoming)) {
      return true;
    }
    previousIndex = matchIndex;
  }

  return false;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
