import {
  getChatGPTSubscriptionAccess,
  markChatGPTSubscriptionReconnectRequired,
} from "../../server/chatgpt-subscription-oauth.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import {
  CHATGPT_SUBSCRIPTION_DEFAULT_MODEL,
  CHATGPT_SUBSCRIPTION_ENDPOINT,
  CHATGPT_SUBSCRIPTION_ENGINE_NAME,
  CHATGPT_SUBSCRIPTION_MODELS,
} from "../chatgpt-subscription-contract.js";
import { createAISDKEngine, PROVIDER_CAPABILITIES } from "./ai-sdk-engine.js";
import type { AgentEngine } from "./types.js";

const OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1";

function requestUrl(input: RequestInfo | URL): URL {
  return input instanceof URL
    ? input
    : new URL(typeof input === "string" ? input : input.url);
}

function copyHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  headers.delete("authorization");
  headers.delete("Authorization");
  return headers;
}

function stripUnsupportedRequestFields(body: BodyInit | null | undefined) {
  if (typeof body !== "string") return body;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return body;
    }
    const request = { ...(parsed as Record<string, unknown>) };
    delete request.max_output_tokens;
    return JSON.stringify(request);
  } catch {
    return body;
  }
}

function currentUserEmail(config: Record<string, unknown>): string {
  const configured =
    typeof config.userEmail === "string" ? config.userEmail.trim() : "";
  if (configured) return configured;
  return getRequestUserEmail()?.trim() ?? "";
}

export function createChatGPTSubscriptionFetch(email: string): typeof fetch {
  return async (input, init) => {
    const access = await getChatGPTSubscriptionAccess(email);
    const parsed = requestUrl(input);
    const rewrite =
      parsed.pathname.includes("/v1/responses") ||
      parsed.pathname.includes("/chat/completions");
    const url = rewrite ? new URL(CHATGPT_SUBSCRIPTION_ENDPOINT) : parsed;
    const headers = copyHeaders(input, init);
    headers.set("authorization", `Bearer ${access.accessToken}`);
    headers.set("originator", "agent-native");
    headers.set("user-agent", "agent-native-framework");
    if (access.accountId) headers.set("ChatGPT-Account-Id", access.accountId);

    const source = input instanceof Request ? input : undefined;
    const requestInit: RequestInit = {
      ...(source
        ? {
            method: source.method,
            body:
              source.method === "GET" || source.method === "HEAD"
                ? undefined
                : source.body,
            signal: source.signal,
          }
        : {}),
      ...(init ?? {}),
      headers,
    };
    if (rewrite) {
      requestInit.body =
        source && init?.body === undefined
          ? stripUnsupportedRequestFields(await source.clone().text())
          : stripUnsupportedRequestFields(requestInit.body);
    }

    const response = await fetch(url, requestInit);
    if (response.status === 401) {
      await markChatGPTSubscriptionReconnectRequired(email).catch(() => {});
    }
    return response;
  };
}

export function createChatGPTSubscriptionEngine(
  config: Record<string, unknown> = {},
): AgentEngine {
  const email = currentUserEmail(config);
  if (!email) {
    throw new Error("A signed-in user is required for a ChatGPT subscription.");
  }

  return createAISDKEngine("openai", {
    name: CHATGPT_SUBSCRIPTION_ENGINE_NAME,
    label: "ChatGPT subscription",
    model: CHATGPT_SUBSCRIPTION_DEFAULT_MODEL,
    supportedModels: CHATGPT_SUBSCRIPTION_MODELS,
    acceptsCustomModels: false,
    capabilities: PROVIDER_CAPABILITIES.openai,
    apiKey: "chatgpt-subscription",
    allowEnvFallback: false,
    baseUrl: OPENAI_RESPONSES_BASE_URL,
    requestFetch: createChatGPTSubscriptionFetch(email),
    forceResponses: true,
    omitMaxOutputTokens: true,
    skipCredentialFailureTracking: true,
  });
}
