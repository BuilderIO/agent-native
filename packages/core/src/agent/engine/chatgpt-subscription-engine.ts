import {
  getChatGPTSubscriptionAccess,
  markChatGPTSubscriptionReconnectRequired,
} from "../../server/chatgpt-subscription-oauth.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import {
  CHATGPT_SUBSCRIPTION_ENDPOINT,
  CHATGPT_SUBSCRIPTION_ENGINE_NAME,
} from "../chatgpt-subscription-contract.js";
import { createAISDKEngine, PROVIDER_CAPABILITIES } from "./ai-sdk-engine.js";
import type { AgentEngine } from "./types.js";

const OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1";
const UNSUPPORTED_RESPONSES_FIELDS = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "previous_response_id",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
] as const;

function requestUrl(input: RequestInfo | URL): URL {
  return input instanceof URL
    ? input
    : new URL(typeof input === "string" ? input : input.url);
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  headers.delete("authorization");
  headers.delete("originator");
  headers.delete("chatgpt-account-id");
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeChatGPTSubscriptionResponsesBody(
  body: unknown,
): string {
  if (typeof body !== "string") {
    throw new Error("Sign in with ChatGPT requires a JSON Responses request.");
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("Sign in with ChatGPT received invalid Responses JSON.");
  }
  if (!isRecord(value) || !Array.isArray(value.input)) {
    throw new Error(
      "Sign in with ChatGPT requires Responses input as an array.",
    );
  }

  const request = { ...value };
  for (const field of UNSUPPORTED_RESPONSES_FIELDS) delete request[field];
  const input = request.input as unknown[];
  request.input = input.map((item) =>
    isRecord(item) && item.role === "system"
      ? { ...item, role: "developer" }
      : item,
  );
  request.store = false;
  request.stream = true;
  return JSON.stringify(request);
}

function currentUserEmail(config: Record<string, unknown>): string {
  const configured =
    typeof config.userEmail === "string" ? config.userEmail.trim() : "";
  if (configured) return configured;
  return getRequestUserEmail()?.trim() ?? "";
}

async function markUnauthorized(email: string, response: Response) {
  if (response.status === 401) {
    await markChatGPTSubscriptionReconnectRequired(email);
  }
}

export interface ChatGPTSubscriptionModelCatalog {
  models: string[];
  modelDisplayNames: Record<string, string>;
}

async function readChatGPTSubscriptionModelCatalog(
  accessToken: string,
  email: string,
): Promise<ChatGPTSubscriptionModelCatalog> {
  const response = await fetch(`${OPENAI_RESPONSES_BASE_URL}/models`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    redirect: "error",
  });
  await markUnauthorized(email, response);
  if (!response.ok) {
    throw new Error(
      `OpenAI ChatGPT model listing failed with HTTP ${response.status}.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("OpenAI returned invalid ChatGPT model-list JSON.");
  }
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    throw new Error("OpenAI returned an invalid ChatGPT model catalog.");
  }

  const models: string[] = [];
  const modelDisplayNameEntries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const item of payload.models) {
    if (!isRecord(item)) {
      throw new Error("OpenAI returned an invalid ChatGPT model-list row.");
    }
    if (item.visibility !== "list") continue;
    const { slug, display_name: displayName } = item;
    if (
      typeof slug !== "string" ||
      !slug.trim() ||
      slug.length > 200 ||
      /[\s\p{Cc}]/u.test(slug) ||
      typeof displayName !== "string" ||
      !displayName.trim() ||
      displayName.length > 200 ||
      /[\p{Cc}]/u.test(displayName)
    ) {
      throw new Error("OpenAI returned an invalid visible ChatGPT model.");
    }
    if (seen.has(slug)) {
      throw new Error("OpenAI returned a duplicate visible ChatGPT model.");
    }
    seen.add(slug);
    models.push(slug);
    modelDisplayNameEntries.push([slug, displayName]);
  }
  if (models.length === 0) {
    throw new Error("The selected ChatGPT account has no visible models.");
  }
  return {
    models,
    modelDisplayNames: Object.fromEntries(modelDisplayNameEntries),
  };
}

export async function listChatGPTSubscriptionModels(
  email: string,
): Promise<ChatGPTSubscriptionModelCatalog> {
  const access = await getChatGPTSubscriptionAccess(email);
  return readChatGPTSubscriptionModelCatalog(access.accessToken, email);
}

export function createChatGPTSubscriptionFetch(email: string): typeof fetch {
  return async (input, init) => {
    const target = requestUrl(input);
    const endpoint = new URL(CHATGPT_SUBSCRIPTION_ENDPOINT);
    if (
      target.origin !== endpoint.origin ||
      target.pathname !== endpoint.pathname ||
      target.search ||
      target.hash
    ) {
      throw new Error(
        "Sign in with ChatGPT requests must use the public OpenAI Responses API.",
      );
    }
    const source = input instanceof Request ? input : undefined;
    const method = init?.method ?? source?.method ?? "GET";
    if (method.toUpperCase() !== "POST") {
      throw new Error("The OpenAI Responses API requires POST requests.");
    }
    const body =
      source && init?.body === undefined
        ? await source.clone().text()
        : init?.body;
    const access = await getChatGPTSubscriptionAccess(email);
    const headers = requestHeaders(input, init);
    headers.set("authorization", `Bearer ${access.accessToken}`);
    headers.set("content-type", "application/json");
    const requestBody = JSON.parse(
      normalizeChatGPTSubscriptionResponsesBody(body),
    ) as Record<string, unknown>;
    if (typeof requestBody.model !== "string" || !requestBody.model.trim()) {
      const catalog = await readChatGPTSubscriptionModelCatalog(
        access.accessToken,
        email,
      );
      const model = catalog.models[0];
      if (!model) {
        throw new Error("The selected ChatGPT account has no visible models.");
      }
      requestBody.model = model;
    }
    const response = await fetch(endpoint, {
      ...(init ?? {}),
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      cache: "no-store",
      redirect: "error",
      ...(source?.signal ? { signal: source.signal } : {}),
    });
    await markUnauthorized(email, response);
    return response;
  };
}

export function createChatGPTSubscriptionEngine(
  config: Record<string, unknown> = {},
): AgentEngine {
  const email = currentUserEmail(config);
  if (!email) {
    throw new Error("A signed-in user is required for ChatGPT plan access.");
  }

  return createAISDKEngine("openai", {
    name: CHATGPT_SUBSCRIPTION_ENGINE_NAME,
    label: "ChatGPT plan access",
    model: typeof config.model === "string" ? config.model : "",
    supportedModels: [],
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
