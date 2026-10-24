import { getBuilderGatewayRequestHeaders } from "../../agent/engine/builder-gateway-headers.js";
import type { JevContextCredentials } from "../../agent/production-agent.js";
import {
  getBuilderProxyOrigin,
  type BuilderGatewayAuth,
} from "../../server/credential-provider.js";
import { loadOptionalPeer } from "../../shared/optional-peer.js";

export const JEV_TIMEOUT_MS = 750;

type JevChoiceAnswer = {
  choice?: unknown;
  probabilities?: unknown;
  score?: unknown;
  confidence?: unknown;
};

export type JevResponse = {
  answers?: Record<string, JevChoiceAnswer & { noul?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type JevQuestion =
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: "score";
      instructions: string;
      criteria: readonly [string, string, ...string[]];
    }
  | {
      type: "noul";
      instructions?: string;
      criteria?: { true?: string; false?: string } | null;
    };

export type JevRequest = {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, JevQuestion>;
};

export interface JevDirectRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function requestJev(options: {
  apiKey?: string;
  directApiKey?: string;
  personalApiKey?: string;
  builderAuth?: BuilderGatewayAuth | null;
  request: JevRequest;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<JevResponse> {
  options.signal?.throwIfAborted();
  const directApiKey =
    options.directApiKey?.trim() || options.personalApiKey?.trim();
  if (options.builderAuth) {
    try {
      return await requestJevThroughBuilder(
        options.builderAuth,
        options.request,
        { signal: options.signal, timeoutMs: options.timeoutMs },
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!directApiKey) throw error;
      console.warn(
        "[agent] Builder Jev proxy unavailable; falling back to the direct Jev API.",
        error instanceof Error ? error.message : "unknown error",
      );
      return requestJevDirect(directApiKey, options.request, options);
    }
  }

  if (!directApiKey) {
    throw new Error("Builder Jev proxy is unavailable.");
  }

  return requestJevDirect(directApiKey, options.request, options);
}

export async function requestJevDirect(
  apiKey: string,
  request: JevRequest,
  options: JevDirectRequestOptions = {},
): Promise<JevResponse> {
  options.signal?.throwIfAborted();
  const sdk = await loadOptionalPeer(
    "@typesafe-ai/sdk",
    () => import("@typesafe-ai/sdk"),
  );
  options.signal?.throwIfAborted();
  const client = new sdk.TypeSafeClient({
    apiKey,
    timeout: Math.max(1, Math.min(60_000, options.timeoutMs ?? JEV_TIMEOUT_MS)),
    retry: { maxRetries: 0 },
  });
  const systemOne = client.systemOne.bind(client) as unknown as (
    request: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
  const questions = Object.fromEntries(
    Object.entries(request.questions).map(([questionName, question]) => [
      questionName,
      question.type === "choice"
        ? sdk.choice(question.instructions, question.criteria)
        : question.type === "score"
          ? sdk.score(question.instructions, question.criteria)
          : sdk.noul(question.instructions, question.criteria),
    ]),
  );
  return (await systemOne(
    {
      ...request,
      questions,
    },
    options.signal ? { signal: options.signal } : undefined,
  )) as JevResponse;
}

export async function requestJevThroughBuilder(
  auth: BuilderGatewayAuth,
  request: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<JevResponse> {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? JEV_TIMEOUT_MS,
  );
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      signal.throwIfAborted();
      const response = await fetch(
        `${getBuilderProxyOrigin().replace(/\/+$/, "")}/agent-native/jev/v1/system-one`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: auth.authorization,
            ...(auth.spaceId ? { "x-builder-api-key": auth.spaceId } : {}),
            ...(auth.userId ? { "x-builder-user-id": auth.userId } : {}),
            ...getBuilderGatewayRequestHeaders(),
          },
          body: JSON.stringify(request),
          signal,
        },
      );
      if (!response.ok) {
        if (attempt === 0 && [429, 529].includes(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          await waitForJevRetry(signal);
          continue;
        }
        throw new Error(`Builder Jev proxy returned HTTP ${response.status}.`);
      }
      const result = (await response.json()) as unknown;
      if (!isJevResponse(result)) {
        throw new Error("Builder Jev proxy returned an invalid response.");
      }
      return result;
    }
    throw new Error("Builder Jev proxy request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

function waitForJevRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, 200);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export async function isBuilderJevEnabled(
  auth: BuilderGatewayAuth,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 3_000,
  );
  try {
    const response = await fetch(
      `${getBuilderProxyOrigin().replace(/\/+$/, "")}/agent-native/jev/v1/status`,
      {
        method: "GET",
        headers: {
          Authorization: auth.authorization,
          ...(auth.spaceId ? { "x-builder-api-key": auth.spaceId } : {}),
          ...(auth.userId ? { "x-builder-user-id": auth.userId } : {}),
          ...getBuilderGatewayRequestHeaders(),
        },
        signal: options.signal
          ? AbortSignal.any([options.signal, controller.signal])
          : controller.signal,
      },
    );
    if (response.status === 403) return false;
    if (!response.ok) {
      throw new Error(`Builder Jev status returned HTTP ${response.status}.`);
    }
    const result = (await response.json()) as unknown;
    if (
      typeof result !== "object" ||
      result === null ||
      !("enabled" in result) ||
      typeof result.enabled !== "boolean"
    ) {
      throw new Error("Builder Jev status returned an invalid response.");
    }
    return result.enabled;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isJevEnabled(
  credentials: JevContextCredentials,
): Promise<boolean> {
  if (credentials.personalApiKey || credentials.directApiKey) return true;
  if (credentials.builderAuth) {
    const enabled = await isBuilderJevEnabled(credentials.builderAuth);
    if (enabled || !credentials.apiKeyLookupFailed) return enabled;
  }
  if (credentials.apiKeyLookupFailed || credentials.builderAuthLookupFailed) {
    throw new Error("Could not check Jev credentials or Builder entitlement.");
  }
  return false;
}

function isJevResponse(value: unknown): value is JevResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "answers" in value &&
    typeof value.answers === "object" &&
    value.answers !== null
  );
}
