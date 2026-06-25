import {
  defineEventHandler,
  getMethod,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";

import { getSession } from "../server/auth.js";
import { getH3App } from "../server/framework-request-handler.js";
import { readBody } from "../server/h3-helpers.js";
import {
  claimBrowserSessionRequest,
  completeBrowserSessionRequest,
  createBrowserSessionRequest,
  disconnectBrowserSession,
  getBrowserSession,
  getBrowserSessionRequest,
  listBrowserSessions,
  registerBrowserSession,
  waitForBrowserSessionRequest,
} from "./store.js";
import type {
  CreateAgentNativeBrowserSessionRequestInput,
  RegisterAgentNativeBrowserSessionInput,
} from "./types.js";

export interface MountBrowserSessionRoutesOptions {
  routePrefix?: string;
  getOwnerFromEvent?: (event: H3Event) => string | Promise<string>;
}

function decodeSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function defaultOwnerFromEvent(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    throw Object.assign(new Error("Authentication required"), {
      statusCode: 401,
    });
  }
  return session.email;
}

async function ownerFromEvent(
  event: H3Event,
  options: MountBrowserSessionRoutesOptions,
): Promise<string> {
  return options.getOwnerFromEvent
    ? options.getOwnerFromEvent(event)
    : defaultOwnerFromEvent(event);
}

function methodNotAllowed(event: H3Event) {
  setResponseStatus(event, 405);
  return { error: "Method not allowed" };
}

function badRequest(event: H3Event, error: string) {
  setResponseStatus(event, 400);
  return { error };
}

function notFound(event: H3Event, error: string) {
  setResponseStatus(event, 404);
  return { error };
}

function errorResponse(event: H3Event, error: unknown) {
  const statusCode =
    typeof (error as { statusCode?: unknown })?.statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
  setResponseStatus(event, statusCode);
  return {
    error: error instanceof Error ? error.message : String(error),
  };
}

async function readJsonBody<T>(event: H3Event): Promise<T> {
  return ((await readBody(event).catch(() => ({}))) || {}) as T;
}

export function mountBrowserSessionRoutes(
  nitroApp: any,
  options: MountBrowserSessionRoutesOptions = {},
): void {
  const routePrefix = options.routePrefix ?? "/_agent-native";
  const basePath = `${routePrefix}/browser-sessions`;

  getH3App(nitroApp).use(
    basePath,
    defineEventHandler(async (event: H3Event) => {
      setResponseHeader(event, "Cache-Control", "no-store");

      const method = getMethod(event);
      const raw = (event.path || "/").split("?")[0];
      const segments = raw
        .replace(/^\/+/, "")
        .split("/")
        .filter(Boolean)
        .map(decodeSegment);

      try {
        const ownerEmail = await ownerFromEvent(event, options);

        if (segments.length === 0) {
          if (method === "GET") {
            const sessions = await listBrowserSessions(ownerEmail);
            return { ok: true, sessions };
          }
          if (method === "POST") {
            const body =
              await readJsonBody<RegisterAgentNativeBrowserSessionInput>(event);
            const session = await registerBrowserSession(ownerEmail, body);
            return { ok: true, session };
          }
          return methodNotAllowed(event);
        }

        const sessionId = segments[0];
        if (!sessionId) return badRequest(event, "sessionId is required");

        if (segments.length === 1) {
          if (method === "GET") {
            const session = await getBrowserSession(ownerEmail, sessionId, {
              includeExpired: true,
            });
            return session
              ? { ok: true, session }
              : notFound(event, "Session not found");
          }
          if (method === "DELETE") {
            const deleted = await disconnectBrowserSession(
              ownerEmail,
              sessionId,
            );
            return { ok: true, deleted };
          }
          return methodNotAllowed(event);
        }

        if (segments[1] === "heartbeat") {
          if (method !== "POST") return methodNotAllowed(event);
          const body =
            await readJsonBody<RegisterAgentNativeBrowserSessionInput>(event);
          const session = await registerBrowserSession(ownerEmail, {
            ...body,
            session: {
              ...(body.session ?? {}),
              id: sessionId,
            },
            sessionId,
          });
          return { ok: true, session };
        }

        if (segments[1] !== "requests") {
          return notFound(event, "Unknown browser-session route");
        }

        if (segments.length === 2) {
          if (method !== "POST") return methodNotAllowed(event);
          const body = await readJsonBody<
            CreateAgentNativeBrowserSessionRequestInput & { wait?: boolean }
          >(event);
          const request = await createBrowserSessionRequest(
            ownerEmail,
            sessionId,
            body,
          );
          if (body.wait === true) {
            const result = await waitForBrowserSessionRequest(
              ownerEmail,
              request.id,
              { timeoutMs: body.timeoutMs },
            );
            return { ok: true, requestId: request.id, result };
          }
          return { ok: true, request };
        }

        if (segments.length === 3 && segments[2] === "claim") {
          if (method !== "POST") return methodNotAllowed(event);
          const request = await claimBrowserSessionRequest(
            ownerEmail,
            sessionId,
          );
          return { ok: true, request };
        }

        const requestId = segments[2];
        if (!requestId) return badRequest(event, "requestId is required");

        if (segments.length === 3) {
          if (method !== "GET") return methodNotAllowed(event);
          const request = await getBrowserSessionRequest(ownerEmail, requestId);
          return request
            ? { ok: true, request }
            : notFound(event, "Request not found");
        }

        if (segments.length === 4 && segments[3] === "complete") {
          if (method !== "POST") return methodNotAllowed(event);
          const body = await readJsonBody<{
            ok?: boolean;
            result?: unknown;
            error?: string;
          }>(event);
          const request = await completeBrowserSessionRequest(
            ownerEmail,
            sessionId,
            requestId,
            body.ok === false
              ? { ok: false, error: body.error, result: body.result }
              : { ok: true, result: body.result },
          );
          return { ok: true, request };
        }

        return notFound(event, "Unknown browser-session route");
      } catch (error) {
        return errorResponse(event, error);
      }
    }),
  );
}
