import {
  assertBodySize,
  defineEventHandler,
  getHeader,
  getMethod,
  readRawBody,
} from "h3";
import type { H3Event } from "h3";

import { getBuilderGatewayRequestHeaders } from "../agent/engine/builder-gateway-headers.js";
import { getOrgContext } from "../org/context.js";
import { getSession, type AuthSession } from "./auth.js";
import {
  getBuilderGatewayBaseUrl,
  resolveBuilderGatewayAuth,
} from "./credential-provider.js";
import { runWithRequestContext } from "./request-context.js";
import { isSameOriginRequest } from "./request-origin.js";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export interface BuilderDesktopGatewayAuth {
  authorization: string;
  spaceId: string | null;
  userId: string | null;
}

export interface BuilderDesktopMessagesProxyDependencies {
  getSession: (event: H3Event) => Promise<Pick<AuthSession, "email"> | null>;
  getOrgContext: (event: H3Event) => Promise<{ orgId: string | null }>;
  resolveGatewayAuth: (identity: {
    userEmail: string;
    orgId: string | null;
  }) => Promise<BuilderDesktopGatewayAuth | null>;
  getGatewayBaseUrl: () => string;
  getGatewayHeaders: () => Record<string, string>;
  fetch: typeof globalThis.fetch;
}

const defaultDependencies: BuilderDesktopMessagesProxyDependencies = {
  getSession,
  getOrgContext,
  resolveGatewayAuth: (identity) => resolveBuilderGatewayAuth(identity),
  getGatewayBaseUrl: getBuilderGatewayBaseUrl,
  getGatewayHeaders: getBuilderGatewayRequestHeaders,
  fetch: (...args) => globalThis.fetch(...args),
};

function jsonError(
  status: number,
  type: string,
  message: string,
  extraHeaders?: HeadersInit,
): Response {
  return new Response(
    JSON.stringify({ type: "error", error: { type, message } }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...Object.fromEntries(new Headers(extraHeaders)),
      },
    },
  );
}

function isAnthropicStreamingMessage(value: unknown): value is {
  model: string;
  messages: unknown[];
  max_tokens: number;
  stream?: true;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.model === "string" &&
    body.model.trim().length > 0 &&
    Array.isArray(body.messages) &&
    body.messages.length > 0 &&
    typeof body.max_tokens === "number" &&
    Number.isSafeInteger(body.max_tokens) &&
    body.max_tokens > 0 &&
    (body.stream === undefined || body.stream === true)
  );
}

function copySafeGatewayResponseHeaders(source: Headers): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  for (const name of [
    "content-type",
    "retry-after",
    "request-id",
    "anthropic-request-id",
  ]) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function createGatewayAbort(event: H3Event): {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const requestSignal = (event as any).req?.signal as AbortSignal | undefined;
  const nodeResponse = (event as any).node?.res as
    | {
        writableEnded?: boolean;
        writableFinished?: boolean;
        once?: (name: string, listener: () => void) => unknown;
        removeListener?: (name: string, listener: () => void) => unknown;
      }
    | undefined;
  const abort = (reason?: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onRequestAbort = () => abort(requestSignal?.reason);
  const onResponseClose = () => {
    if (!nodeResponse?.writableEnded && !nodeResponse?.writableFinished)
      abort();
  };

  if (requestSignal?.aborted) onRequestAbort();
  else requestSignal?.addEventListener("abort", onRequestAbort, { once: true });
  nodeResponse?.once?.("close", onResponseClose);

  return {
    signal: controller.signal,
    abort,
    cleanup: () => {
      requestSignal?.removeEventListener("abort", onRequestAbort);
      nodeResponse?.removeListener?.("close", onResponseClose);
    },
  };
}

function streamGatewayResponse(
  response: Response,
  abort: ReturnType<typeof createGatewayAbort>,
): Response {
  const headers = copySafeGatewayResponseHeaders(response.headers);
  if (!response.body) {
    abort.cleanup();
    if (response.ok) {
      return jsonError(
        502,
        "api_error",
        "Builder Gateway returned an empty response.",
      );
    }
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          abort.cleanup();
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        abort.cleanup();
        controller.error(error);
      }
    },
    async cancel(reason) {
      abort.abort(reason);
      await reader.cancel(reason).catch(() => undefined);
      abort.cleanup();
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Anthropic Messages-compatible, session-authenticated streaming endpoint for
 * Desktop Code Agents. Builder credentials stay on the server and are resolved
 * in the signed-in user's active organization context.
 */
export function createBuilderDesktopMessagesHandler(
  overrides: Partial<BuilderDesktopMessagesProxyDependencies> = {},
) {
  const deps = { ...defaultDependencies, ...overrides };

  return defineEventHandler(async (event: H3Event): Promise<Response> => {
    if (getMethod(event) !== "POST") {
      return jsonError(405, "invalid_request_error", "Method not allowed", {
        allow: "POST",
      });
    }
    if (!isSameOriginRequest(event)) {
      return jsonError(
        403,
        "authentication_error",
        "Cross-origin request rejected.",
      );
    }

    let session: Pick<AuthSession, "email"> | null;
    try {
      session = await deps.getSession(event);
    } catch {
      return jsonError(
        503,
        "api_error",
        "Could not read the signed-in session. Try again shortly.",
      );
    }
    const userEmail = session?.email?.trim();
    if (!userEmail) {
      return jsonError(401, "authentication_error", "Authentication required");
    }

    const abort = createGatewayAbort(event);
    let streamOwnsAbort = false;
    try {
      const contentType = getHeader(event, "content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        return jsonError(
          415,
          "invalid_request_error",
          "Content-Type must be application/json.",
        );
      }
      const beta = getHeader(event, "anthropic-beta");
      if (beta && (beta.length > 2048 || /[\r\n]/.test(beta))) {
        return jsonError(
          400,
          "invalid_request_error",
          "anthropic-beta is invalid or too long.",
        );
      }

      let rawBody: string;
      try {
        await assertBodySize(event, MAX_REQUEST_BYTES);
        rawBody = (await readRawBody(event, "utf8")) ?? "";
      } catch (error) {
        const status =
          (error as { statusCode?: unknown })?.statusCode === 413 ? 413 : 400;
        return jsonError(
          status,
          "invalid_request_error",
          status === 413
            ? "Request body is too large."
            : "Invalid request body.",
        );
      }

      if (abort.signal.aborted) return new Response(null, { status: 499 });

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        return jsonError(
          400,
          "invalid_request_error",
          "Request body must be JSON.",
        );
      }
      if (!isAnthropicStreamingMessage(parsedBody)) {
        return jsonError(
          400,
          "invalid_request_error",
          "A valid Anthropic Messages request is required.",
        );
      }
      const upstreamBody = JSON.stringify({
        ...(parsedBody as Record<string, unknown>),
        stream: true,
      });

      let orgId: string | null;
      try {
        orgId = (await deps.getOrgContext(event)).orgId;
      } catch {
        return jsonError(
          503,
          "api_error",
          "Could not resolve the active workspace. Try again shortly.",
        );
      }

      if (abort.signal.aborted) {
        abort.cleanup();
        return new Response(null, { status: 499 });
      }

      return await runWithRequestContext(
        { userEmail, orgId: orgId ?? undefined },
        async () => {
          let credentials: BuilderDesktopGatewayAuth | null;
          try {
            credentials = await deps.resolveGatewayAuth({ userEmail, orgId });
          } catch {
            return jsonError(
              503,
              "api_error",
              "Could not read the Builder connection. Try again shortly.",
            );
          }
          if (!credentials) {
            return jsonError(
              403,
              "authentication_error",
              "Connect Builder.io before using this model.",
            );
          }
          if (abort.signal.aborted) return new Response(null, { status: 499 });

          let gatewayUrl: URL;
          try {
            const baseUrl = deps.getGatewayBaseUrl();
            gatewayUrl = new URL(
              "messages",
              baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
            );
          } catch {
            return jsonError(
              503,
              "api_error",
              "Builder Gateway is unavailable.",
            );
          }
          gatewayUrl.search = "";
          gatewayUrl.hash = "";
          if (credentials.spaceId) {
            gatewayUrl.searchParams.set("apiKey", credentials.spaceId);
          }

          const headers = new Headers({
            "content-type": "application/json",
            authorization: credentials.authorization,
            "anthropic-version":
              getHeader(event, "anthropic-version") ??
              DEFAULT_ANTHROPIC_VERSION,
          });
          if (beta) headers.set("anthropic-beta", beta);
          if (credentials.spaceId) {
            headers.set("x-builder-api-key", credentials.spaceId);
          }
          if (credentials.userId) {
            headers.set("x-builder-user-id", credentials.userId);
          }
          for (const [name, value] of Object.entries(
            deps.getGatewayHeaders(),
          )) {
            headers.set(name, value);
          }

          let upstream: Response;
          try {
            upstream = await deps.fetch(gatewayUrl, {
              method: "POST",
              headers,
              body: upstreamBody,
              redirect: "manual",
              signal: abort.signal,
            });
          } catch {
            return jsonError(
              502,
              "api_error",
              "Builder Gateway could not be reached.",
            );
          }

          const proxied = streamGatewayResponse(upstream, abort);
          streamOwnsAbort = true;
          return proxied;
        },
      );
    } finally {
      if (!streamOwnsAbort) abort.cleanup();
    }
  });
}
