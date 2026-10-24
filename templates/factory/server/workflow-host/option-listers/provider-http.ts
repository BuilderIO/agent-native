import { isAgentConnectionRequiredError } from "@agent-native/core/action";

import { executeProviderApiRequest } from "../../lib/provider-api.js";
import { scrub } from "../../tripwire/redact.js";
import {
  OptionListError,
  type OptionProvider,
  type ProviderHttp,
  type ProviderHttpResponse,
} from "./types.js";

const LIST_TIMEOUT_MS = 15_000;
const LIST_MAX_BYTES = 2 * 1024 * 1024;

const PROVIDER_LABEL: Record<OptionProvider, string> = {
  slack: "Slack",
  sentry: "Sentry",
  github: "GitHub",
};

// Core words a missing credential as a plain error, so the text is the only signal.
const NOT_CONFIGURED =
  /\bnot configured\b|requires an available workspace connection|require a workspace connectionId/;

function isCredentialAbsence(error: unknown): boolean {
  return (
    isAgentConnectionRequiredError(error) ||
    NOT_CONFIGURED.test(error instanceof Error ? error.message : "")
  );
}

// What Node and undici raise when a connection never produced an answer.
const NETWORK_ERROR_CODE =
  /^(?:ECONN[A-Z]+|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET))$/;
const MAX_CAUSE_DEPTH = 4;

/** Core wraps a request that failed or timed out in a plain Error and keeps the original as `cause`. */
function isNetworkOrTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && typeof current === "object" && current !== null;
    depth += 1
  ) {
    const { name, code, message, cause } = current as {
      name?: unknown;
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (name === "AbortError" || name === "TimeoutError") return true;
    if (typeof code === "string" && NETWORK_ERROR_CODE.test(code)) return true;
    if (name === "TypeError" && message === "fetch failed") return true;
    current = cause;
  }
  return false;
}

function headerStrings(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const headers: Record<string, string> = {};
  for (const [name, text] of Object.entries(value)) {
    if (typeof text === "string") headers[name.toLowerCase()] = text;
  }
  return headers;
}

function retryAfterSeconds(
  headers: Record<string, string>,
  quota: { retryAfterMs?: unknown } | undefined,
): number | undefined {
  if (typeof quota?.retryAfterMs === "number") {
    return Math.max(0, Math.ceil(quota.retryAfterMs / 1000));
  }
  const header = Number(headers["retry-after"]);
  return Number.isFinite(header) && header >= 0 ? header : undefined;
}

function readResponse(
  provider: OptionProvider,
  result: unknown,
): ProviderHttpResponse {
  const response = (
    result as {
      response?: {
        status?: unknown;
        ok?: unknown;
        truncated?: unknown;
        json?: unknown;
        headers?: unknown;
        quota?: { retryAfterMs?: unknown };
      };
    } | null
  )?.response;
  if (
    !response ||
    typeof response.status !== "number" ||
    typeof response.ok !== "boolean"
  ) {
    throw new OptionListError(
      "provider_unreadable",
      provider,
      `${PROVIDER_LABEL[provider]} sent an answer Factory could not read.`,
    );
  }
  const headers = headerStrings(response.headers);
  const retryAfter = retryAfterSeconds(headers, response.quota);
  return {
    status: response.status,
    ok: response.ok,
    truncated: response.truncated === true,
    json: response.json,
    headers,
    ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
  };
}

/**
 * Sends a GET through the same provider runtime a workflow's provider
 * operations use, so the credential is whatever the workspace connection,
 * vault or local development key resolves for the signed-in member.
 */
export function createProviderHttp(
  provider: OptionProvider,
  signal?: AbortSignal,
): ProviderHttp {
  return async ({ path, query }) => {
    let result: unknown;
    try {
      result = await executeProviderApiRequest({
        provider,
        method: "GET",
        path,
        ...(query ? { query } : {}),
        timeoutMs: LIST_TIMEOUT_MS,
        maxBytes: LIST_MAX_BYTES,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isCredentialAbsence(error)) {
        throw new OptionListError(
          "credential_missing",
          provider,
          `${PROVIDER_LABEL[provider]} is not connected for this workspace.`,
          { reason: "not_connected" },
        );
      }
      const network = isNetworkOrTimeout(error);
      // The message is scrubbed: core's own text names the request's path and query.
      console.error(
        `[option-listers] ${provider} list request did not complete (${network ? "network or timeout" : "unexpected"}): ${error instanceof Error ? error.name : typeof error}: ${scrub(error instanceof Error ? error.message : String(error))}`,
      );
      throw new OptionListError(
        "provider_unreadable",
        provider,
        `The request to ${PROVIDER_LABEL[provider]} did not complete.`,
        { retryable: network },
      );
    }
    return readResponse(provider, result);
  };
}

/**
 * The parsed body of a successful answer; every other answer is a typed
 * failure. `bodyFailure` sees the body first, for a provider that reports an
 * error with a 200 (Slack's `ok: false`).
 */
export function expectJson(
  provider: OptionProvider,
  response: ProviderHttpResponse,
  bodyFailure?: (json: unknown) => OptionListError | undefined,
): unknown {
  const label = PROVIDER_LABEL[provider];
  const { status } = response;
  if (response.truncated) {
    throw new OptionListError(
      "provider_unreadable",
      provider,
      `${label} sent a list too long to read whole.`,
      { status },
    );
  }
  if (status === 429) {
    throw rateLimited(provider, response.retryAfterSeconds, status);
  }
  if (status === 401 || status === 403) {
    throw new OptionListError(
      "credential_missing",
      provider,
      `${label} refused the connected credential (HTTP ${status}).`,
      { reason: "refused", status },
    );
  }
  const failure = bodyFailure?.(response.json);
  if (failure) throw failure;
  if (!response.ok) {
    throw new OptionListError(
      "provider_unreadable",
      provider,
      `${label} rejected the request (HTTP ${status}).`,
      { status, retryable: status === 408 || status >= 500 },
    );
  }
  if (response.json === undefined) {
    throw new OptionListError(
      "provider_unreadable",
      provider,
      `${label} sent an answer that is not JSON.`,
      { status },
    );
  }
  return response.json;
}

export function rateLimited(
  provider: OptionProvider,
  retryAfterSeconds?: number,
  status?: number,
): OptionListError {
  return new OptionListError(
    "rate_limited",
    provider,
    `${PROVIDER_LABEL[provider]} is rate limiting this workspace.`,
    {
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      ...(status === undefined ? {} : { status }),
    },
  );
}

export function unreadableList(
  provider: OptionProvider,
  what: string,
): OptionListError {
  return new OptionListError(
    "provider_unreadable",
    provider,
    `${PROVIDER_LABEL[provider]} sent ${what} Factory could not read.`,
  );
}

/**
 * The `cursor` of a Link header's `rel="next"` entry. Sentry marks an entry
 * `results="false"` when nothing follows, and still sends it.
 */
export function nextLinkCursor(
  headers: Readonly<Record<string, string>>,
): string | undefined {
  const link = headers.link;
  if (!link) return undefined;
  for (const entry of link.split(/,\s*(?=<)/)) {
    if (!/rel="next"/.test(entry) || /results="false"/.test(entry)) continue;
    return /cursor="([^"]+)"/.exec(entry)?.[1];
  }
  return undefined;
}
