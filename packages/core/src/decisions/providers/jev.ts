import { getBuilderGatewayRequestHeaders } from "../../agent/engine/builder-gateway-headers.js";
import type { JevContextCredentials } from "../../agent/production-agent.js";
import {
  getBuilderProxyOrigin,
  type BuilderGatewayAuth,
} from "../../server/credential-provider.js";
import { loadOptionalPeer } from "../../shared/optional-peer.js";

export const JEV_TIMEOUT_MS = 750;

export type JevProviderRequestFailure =
  | "aborted"
  | "timeout"
  | "provider_error"
  | "invalid_response";

export class JevProviderRequestError extends Error {
  constructor(
    readonly reason: JevProviderRequestFailure,
    cause?: unknown,
  ) {
    super(`Jev request failed: ${reason}.`, { cause });
    this.name = "JevProviderRequestError";
  }
}

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
  if (options.signal?.aborted) {
    throw new JevProviderRequestError("aborted", options.signal.reason);
  }
  const timeoutMs = options.timeoutMs ?? JEV_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new JevProviderRequestError("timeout");
  }
  const deadlineAt = Date.now() + Math.min(60_000, timeoutMs);
  const directApiKey =
    options.directApiKey?.trim() || options.personalApiKey?.trim();
  if (options.builderAuth) {
    try {
      return await requestJevThroughBuilder(
        options.builderAuth,
        options.request,
        { signal: options.signal, timeoutMs: remainingBudget(deadlineAt) },
      );
    } catch (error) {
      if (options.signal?.aborted) {
        throw new JevProviderRequestError("aborted", options.signal.reason);
      }
      if (error instanceof JevProviderRequestError) throw error;
      const remainingMs = remainingBudget(deadlineAt);
      if (remainingMs <= 0) {
        throw new JevProviderRequestError("timeout", error);
      }
      if (!directApiKey) {
        throw new JevProviderRequestError("provider_error", error);
      }
      console.warn(
        "[agent] Builder Jev proxy unavailable; falling back to the direct Jev API.",
        error instanceof Error ? error.message : "unknown error",
      );
      return requestJevDirectWithBudget(
        directApiKey,
        options.request,
        options.signal,
        deadlineAt,
      );
    }
  }

  if (!directApiKey) {
    throw new JevProviderRequestError("provider_error");
  }

  return requestJevDirectWithBudget(
    directApiKey,
    options.request,
    options.signal,
    deadlineAt,
  );
}

function remainingBudget(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}

async function requestJevDirectWithBudget(
  apiKey: string,
  request: JevRequest,
  signal: AbortSignal | undefined,
  deadlineAt: number,
): Promise<JevResponse> {
  const timeoutMs = remainingBudget(deadlineAt);
  if (signal?.aborted) {
    throw new JevProviderRequestError("aborted", signal.reason);
  }
  if (timeoutMs <= 0) throw new JevProviderRequestError("timeout");
  try {
    return await requestJevDirect(apiKey, request, { signal, timeoutMs });
  } catch (error) {
    if (signal?.aborted) {
      throw new JevProviderRequestError("aborted", signal.reason);
    }
    if (remainingBudget(deadlineAt) <= 0 || isAbortError(error)) {
      throw new JevProviderRequestError("timeout", error);
    }
    if (error instanceof JevProviderRequestError) throw error;
    throw new JevProviderRequestError("provider_error", error);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
  if (options.signal?.aborted) {
    throw new JevProviderRequestError("aborted", options.signal.reason);
  }
  const timeoutMs = options.timeoutMs ?? JEV_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new JevProviderRequestError("timeout");
  }
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    Math.min(60_000, timeoutMs),
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
  } catch (error) {
    if (options.signal?.aborted) {
      throw new JevProviderRequestError("aborted", options.signal.reason);
    }
    if (controller.signal.aborted) {
      throw new JevProviderRequestError("timeout", error);
    }
    throw error;
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
  if (options.signal?.aborted) {
    throw new JevProviderRequestError("aborted", options.signal.reason);
  }
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new JevProviderRequestError("timeout");
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    Math.min(60_000, timeoutMs),
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
  } catch (error) {
    if (options.signal?.aborted) {
      throw new JevProviderRequestError("aborted", options.signal.reason);
    }
    if (controller.signal.aborted) {
      throw new JevProviderRequestError("timeout", error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isJevEnabled(
  credentials: JevContextCredentials,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<boolean> {
  if (options.signal?.aborted) {
    throw new JevProviderRequestError("aborted", options.signal.reason);
  }
  if (credentials.personalApiKey || credentials.directApiKey) return true;
  if (credentials.builderAuth) {
    const enabled = await isBuilderJevEnabled(credentials.builderAuth, options);
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
