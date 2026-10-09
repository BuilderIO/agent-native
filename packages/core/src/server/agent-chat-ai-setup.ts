import { createError } from "h3";

import { CHATGPT_SUBSCRIPTION_ENGINE_NAME } from "../agent/chatgpt-subscription-contract.js";
import type { AgentEngineStatusResult } from "../agent/engine-status.js";
import {
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
  PROVIDER_ENV_VARS,
} from "../agent/engine/provider-env-vars.js";
import { getAgentEngineEntry } from "../agent/engine/registry.js";
import type { AgentEngineEntry } from "../agent/engine/registry.js";
import { hasUsableBuilderOAuthSessionForReadiness } from "./builder-oauth.js";
import {
  assertCredentialStoreReadable,
  getProviderCredentialAuthFailure,
  prefetchSecrets,
  resolveBuilderGatewayCredentialsDetailed,
  resolveBuilderPrivateKey,
  resolveSecretDetailed,
} from "./credential-provider.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

export const AGENT_CHAT_AI_SETUP_REQUIRED_CODE =
  "AGENT_CHAT_AI_SETUP_REQUIRED" as const;

export function isBuilderChatSetupReady(input: {
  oauthSessionUsable?: boolean;
  privateKey?: string | null;
  publicKey?: string | null;
  legacyPrivateKey?: string | null;
}): boolean {
  return Boolean(
    input.oauthSessionUsable ||
    (input.privateKey?.trim() && input.publicKey?.trim()) ||
    input.legacyPrivateKey?.trim(),
  );
}

/**
 * Chat accepts the Builder gateway/OAuth lane, a usable BYOK API key, or a
 * configured OpenAI-compatible/Ollama endpoint. Engine selection by itself is
 * not readiness: ChatGPT subscription auth and untyped engine names do not
 * qualify.
 */
export async function isAgentChatAiSetupReady(input?: {
  status?: AgentEngineStatusResult;
  detectFromUserSecrets?: () => Promise<AgentEngineEntry | null>;
}): Promise<boolean> {
  if (input?.status && input.detectFromUserSecrets) {
    const entry = input.status.engine
      ? getAgentEngineEntry(input.status.engine)
      : undefined;
    if (input.status.configured && isChatSetupProviderEntry(entry)) return true;
    if (input.status.openAiBaseUrlConfigured) return true;
    const ollama = await resolveSecretDetailed(OLLAMA_BASE_URL_ENV_VAR);
    assertCredentialStoreReadable(ollama);
    if (ollama.value?.trim()) return true;
    return isChatSetupProviderEntry(await input.detectFromUserSecrets());
  }

  const ownerEmail = getRequestUserEmail();
  const orgId = getRequestOrgId();
  const identity = ownerEmail ? { userEmail: ownerEmail, orgId } : undefined;
  if (
    isBuilderChatSetupReady({
      oauthSessionUsable: ownerEmail
        ? await hasUsableBuilderOAuthSessionForReadiness(ownerEmail, orgId)
        : false,
    })
  ) {
    return true;
  }
  const builderCredentials =
    await resolveBuilderGatewayCredentialsDetailed(identity);
  assertCredentialStoreReadable(builderCredentials);
  if (
    isBuilderChatSetupReady({
      privateKey: builderCredentials.privateKey,
      publicKey: builderCredentials.publicKey,
    })
  ) {
    return true;
  }
  const legacyBuilderKey = await resolveBuilderPrivateKey(identity);
  if (isBuilderChatSetupReady({ legacyPrivateKey: legacyBuilderKey })) {
    return true;
  }

  const customEndpointKeys = [
    OPENAI_BASE_URL_ENV_VAR,
    OLLAMA_BASE_URL_ENV_VAR,
  ] as const;
  await prefetchSecrets([...PROVIDER_ENV_VARS, ...customEndpointKeys]);
  const resolved = await Promise.all(
    [...PROVIDER_ENV_VARS, ...customEndpointKeys].map((key) =>
      resolveSecretDetailed(key).then((value) => ({ key, value })),
    ),
  );
  const providerCandidates = resolved.filter(
    ({ key, value }) =>
      PROVIDER_ENV_VARS.includes(key) &&
      Boolean(value.value?.trim()) &&
      (value.source === "user" ||
        value.source === "org" ||
        value.source === "workspace" ||
        value.source === "env"),
  );
  const providerReadiness = await Promise.all(
    providerCandidates.map(async ({ key, value }) => ({
      key,
      resolved: value,
      usable: !(await getProviderCredentialAuthFailure({
        key,
        value: value.value!.trim(),
      })),
    })),
  );
  if (providerReadiness.some((candidate) => candidate.usable)) return true;
  const customEndpointIsConfigured = resolved.some(
    ({ key, value }) =>
      !PROVIDER_ENV_VARS.includes(key) &&
      Boolean(value.value?.trim()) &&
      (value.source === "user" ||
        value.source === "org" ||
        value.source === "workspace" ||
        value.source === "env"),
  );
  if (customEndpointIsConfigured) return true;

  const unreadable = resolved.find(({ value }) => value.lookupFailed)?.value;
  if (unreadable) {
    assertCredentialStoreReadable(unreadable);
    throw createError({
      statusCode: 503,
      statusMessage: "Could not read saved AI connections. Try again shortly.",
    });
  }

  return false;
}

function isChatSetupProviderEntry(
  entry: Pick<AgentEngineEntry, "name" | "requiredEnvVars"> | undefined | null,
): boolean {
  return (
    entry !== undefined &&
    entry !== null &&
    entry.name !== CHATGPT_SUBSCRIPTION_ENGINE_NAME &&
    entry.name !== "ai-sdk:ollama" &&
    (entry.name === "builder" ||
      entry.requiredEnvVars.some((key) => PROVIDER_ENV_VARS.includes(key)))
  );
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
