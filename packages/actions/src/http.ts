import type { IncomingMessage, ServerResponse } from "node:http";

import { ActionError, serializeActionErrorBody } from "./errors.js";
import type { ActionHttpHandlerOptions, ActionsRegistry } from "./registry.js";
import type { ActionHttpMethod, ActionMap } from "./types.js";

const DEFAULT_CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const DEFAULT_CORS_HEADERS =
  "Content-Type, Authorization, X-Action-Approval, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID";

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

function buildCorsHeaders(
  request: Request,
  cors: ActionHttpHandlerOptions["cors"],
): Record<string, string> {
  if (!cors) return {};
  const origin = request.headers.get("origin");
  if (!origin) return {};

  let allowOrigin: string | null = null;
  if (cors === true) {
    allowOrigin = "*";
  } else if (typeof cors.origin === "string") {
    allowOrigin = cors.origin;
  } else if (Array.isArray(cors.origin)) {
    allowOrigin = cors.origin.includes(origin) ? origin : null;
  } else if (typeof cors.origin === "function") {
    allowOrigin = cors.origin(origin) ? origin : null;
  }

  if (!allowOrigin) return {};
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": DEFAULT_CORS_METHODS,
    "Access-Control-Allow-Headers": DEFAULT_CORS_HEADERS,
    Vary: "Origin",
  };
  if (typeof cors === "object" && cors.credentials && allowOrigin !== "*") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

function checkCsrfOrigin(
  request: Request,
  csrfProtection: boolean,
): Response | null {
  if (!csrfProtection) return null;
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }
  const hasCookie = Boolean(request.headers.get("cookie"));
  const hasBearer = Boolean(request.headers.get("authorization"));
  if (!hasCookie || hasBearer) return null;

  const origin = request.headers.get("origin");
  if (!origin) return null;

  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin) {
    return jsonResponse(
      {
        error: "Cross-origin cookie mutation rejected.",
        errorCode: "csrf_origin_mismatch",
      },
      403,
    );
  }
  return null;
}

function parseQueryParams(url: URL): Record<string, unknown> {
  const encodedInput = url.searchParams.get("input");
  if (encodedInput !== null) {
    try {
      const parsed: unknown = JSON.parse(encodedInput);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      throw new ActionError('Query parameter "input" must be a JSON object.', {
        statusCode: 400,
        errorCode: "invalid_input",
      });
    } catch (error) {
      if (error instanceof ActionError) throw error;
      throw new ActionError('Query parameter "input" is not valid JSON.', {
        statusCode: 400,
        errorCode: "invalid_input",
      });
    }
  }

  const params: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = params[key];
    if (existing !== undefined) {
      params[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else if (value === "true") {
      params[key] = true;
    } else if (value === "false") {
      params[key] = false;
    } else {
      params[key] = value;
    }
  }
  return params;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength === "0") return {};

  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ActionError("Request body must be valid JSON.", {
      statusCode: 400,
      errorCode: "invalid_json",
    });
  }
}

export function stripBasePath(pathname: string, basePath: string): string {
  const normalizedBase = basePath.replace(/\/+$/, "");
  if (!normalizedBase || normalizedBase === "/") {
    return pathname.replace(/^\/+/, "");
  }
  if (pathname === normalizedBase) return "";
  if (pathname.startsWith(`${normalizedBase}/`)) {
    return pathname.slice(normalizedBase.length + 1);
  }
  return pathname.replace(/^\/+/, "");
}

export function createActionFetchHandler<
  TCtx,
  TActions extends ActionMap<TCtx>,
>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: ActionHttpHandlerOptions = {},
): (
  request: Request,
  override?: { actionPath?: string; platform?: unknown },
) => Promise<Response> {
  const basePath = options.basePath ?? "/api/agent-native/actions";
  const csrfProtection = options.csrfProtection ?? true;

  return async (request, override) => {
    const corsHeaders = buildCorsHeaders(request, options.cors);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          Allow: DEFAULT_CORS_METHODS,
          ...corsHeaders,
        },
      });
    }

    const csrfBlock = checkCsrfOrigin(request, csrfProtection);
    if (csrfBlock) return csrfBlock;

    const url = new URL(request.url);
    const relativePath =
      override?.actionPath !== undefined
        ? override.actionPath.replace(/^\/+/, "")
        : stripBasePath(url.pathname, basePath);

    if (!relativePath) {
      if (method === "GET") {
        return jsonResponse({ actions: registry.describe() }, 200, corsHeaders);
      }
      return jsonResponse(
        { error: "Action name is required.", errorCode: "not_found" },
        404,
        corsHeaders,
      );
    }

    const resolved = registry.resolveHttpAction(relativePath);
    if (!resolved) {
      return jsonResponse(
        {
          error: `Action "${relativePath}" not found.`,
          errorCode: "not_found",
        },
        404,
        corsHeaders,
      );
    }

    const expectedMethod: ActionHttpMethod = resolved.method;
    if (
      method !== expectedMethod &&
      !(expectedMethod === "GET" && method === "POST")
    ) {
      return jsonResponse(
        {
          error: `Action "${resolved.name}" expects ${expectedMethod}, received ${method}.`,
          errorCode: "method_not_allowed",
        },
        405,
        { Allow: expectedMethod, ...corsHeaders },
      );
    }

    try {
      const rawInput =
        method === "GET" ? parseQueryParams(url) : await readJsonBody(request);

      const approvalToken =
        request.headers.get("x-action-approval") ?? undefined;

      const result = await registry.invokeFromRequest(resolved.name, rawInput, {
        caller: "http",
        request,
        ...(approvalToken !== undefined ? { approvalToken } : {}),
        ...(override?.platform !== undefined
          ? { platform: override.platform }
          : {}),
      });

      return jsonResponse(result ?? null, 200, corsHeaders);
    } catch (error) {
      const { statusCode, body } = serializeActionErrorBody(error);
      return jsonResponse(body, statusCode, corsHeaders);
    }
  };
}

export type FetchHandler = (
  request: Request,
  override?: { actionPath?: string; platform?: unknown },
) => Promise<Response>;

type NodeRequestWithBody = IncomingMessage & {
  body?: unknown;
  originalUrl?: string | undefined;
};

/**
 * Adapt any Web Standard Fetch handler (`actions.handler`, `actions.fetchHandler`,
 * or `actions.mcpHandler`) to Node's `(req, res)` signature for Express, Fastify,
 * Connect, or `node:http`.
 */
export function toNodeHandler(
  handler: FetchHandler,
): (req: NodeRequestWithBody, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const protoHeader = req.headers["x-forwarded-proto"];
    const protocol =
      typeof protoHeader === "string"
        ? (protoHeader.split(",")[0] ?? "http").trim()
        : "http";
    const host = req.headers.host ?? "localhost";
    const reqUrl = req.url ?? "/";
    const fullUrl = new URL(reqUrl, `${protocol}://${host}`).toString();

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      }
    }

    const method = (req.method ?? "GET").toUpperCase();
    let body: BodyInit | undefined;

    if (method !== "GET" && method !== "HEAD") {
      if (req.body !== undefined) {
        body =
          typeof req.body === "string"
            ? req.body
            : req.body instanceof Uint8Array
              ? new Uint8Array(req.body)
              : JSON.stringify(req.body);
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      } else {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(
            typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk),
          );
        }
        if (chunks.length > 0) {
          body = new Uint8Array(Buffer.concat(chunks));
        }
      }
    }

    const controller = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    const request = new Request(fullUrl, {
      method,
      headers,
      signal: controller.signal,
      ...(body !== undefined ? { body } : {}),
    });

    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    const reader = response.body.getReader();
    try {
      for (
        let chunk = await reader.read();
        !chunk.done;
        chunk = await reader.read()
      ) {
        if (res.writableEnded) break;
        res.write(chunk.value);
      }
    } finally {
      reader.releaseLock();
      if (!res.writableEnded) res.end();
    }
  };
}
