import { createError, getHeader, type H3Event } from "h3";

import { resolveOrgIdForEmail, getOrgContext } from "../org/context.js";
import { getSession } from "./auth.js";
import {
  runWithRequestContext,
  type RequestContext,
} from "./request-context.js";

export type AgentRunOwnerContext = {
  owner: string;
  anonymous: boolean;
  name?: string;
};

export const AGENT_RUN_OWNER_CONTEXT_KEY = "__agentNativeOwnerContext";

type EventWithAgentRunContext = H3Event & {
  context?: Record<string, unknown>;
};

type AnonymousOwnerResolver = (
  event: H3Event,
) => string | null | Promise<string | null>;

type OrgIdResolver = (
  event: H3Event,
) => string | null | undefined | Promise<string | null | undefined>;

function eventContext(
  event: EventWithAgentRunContext,
): Record<string, unknown> {
  event.context = event.context ?? {};
  return event.context;
}

function normalizeId(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readHeaderValue(event: any, name: string): unknown {
  try {
    const value = getHeader(event, name);
    if (value !== undefined && value !== null) return value;
  } catch {
    // Unit tests and a few framework internals pass lightweight event shims.
  }

  const headers = event?.headers;
  if (headers && typeof headers.get === "function") {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
  }

  const reqHeaders = event?.node?.req?.headers ?? event?.req?.headers;
  if (reqHeaders && typeof reqHeaders === "object") {
    return reqHeaders[name] ?? reqHeaders[name.toLowerCase()];
  }

  return undefined;
}

export function readAgentRunTimezone(event: H3Event): string | undefined {
  const raw = readHeaderValue(event, "x-user-timezone");
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length < 64
    ? value.trim()
    : undefined;
}

export function seedAgentRunOwnerContext(
  event: H3Event,
  ownerContext: AgentRunOwnerContext,
): AgentRunOwnerContext {
  eventContext(event as EventWithAgentRunContext)[AGENT_RUN_OWNER_CONTEXT_KEY] =
    ownerContext;
  return ownerContext;
}

export async function seedBackgroundAgentRunOwnerContext(
  event: H3Event,
  runId: string,
): Promise<AgentRunOwnerContext | null> {
  try {
    const { getRunOwnerEmail } = await import("../agent/run-store.js");
    const owner = await getRunOwnerEmail(runId);
    if (!owner) return null;
    return seedAgentRunOwnerContext(event, { owner, anonymous: false });
  } catch {
    return null;
  }
}

export async function resolveAgentRunOwnerContext(
  event: H3Event,
  options: { anonymousOwner?: AnonymousOwnerResolver } = {},
): Promise<AgentRunOwnerContext> {
  const ctx = eventContext(event as EventWithAgentRunContext);
  const seeded = ctx[AGENT_RUN_OWNER_CONTEXT_KEY] as
    | AgentRunOwnerContext
    | undefined;
  if (seeded) return seeded;

  const session = await getSession(event);
  if (session?.email) {
    return seedAgentRunOwnerContext(event, {
      owner: session.email,
      anonymous: false,
      name: session.name,
    });
  }

  const anonymousOwner = await options.anonymousOwner?.(event);
  if (anonymousOwner) {
    return seedAgentRunOwnerContext(event, {
      owner: anonymousOwner,
      anonymous: true,
    });
  }

  throw createError({
    statusCode: 401,
    statusMessage: "Unauthenticated",
  });
}

export async function resolveAgentRunOrgId(options: {
  event: H3Event;
  ownerContext: AgentRunOwnerContext;
  resolveOrgId?: OrgIdResolver;
}): Promise<string | undefined> {
  let resolvedOrgId: string | undefined;

  if (options.resolveOrgId) {
    resolvedOrgId = normalizeId(await options.resolveOrgId(options.event));
  } else {
    try {
      const session = await getSession(options.event);
      resolvedOrgId = normalizeId(session?.orgId);
    } catch {
      // Session not available.
    }

    if (!resolvedOrgId) {
      try {
        const orgContext = await getOrgContext(options.event);
        resolvedOrgId = normalizeId(orgContext.orgId);
      } catch {
        // Org tables may not exist yet on first boot.
      }
    }
  }

  if (
    !resolvedOrgId &&
    options.ownerContext.owner &&
    !options.ownerContext.anonymous
  ) {
    try {
      resolvedOrgId = normalizeId(
        await resolveOrgIdForEmail(options.ownerContext.owner),
      );
    } catch {
      // Org tables may not exist yet on first boot.
    }
  }

  return resolvedOrgId;
}

export async function resolveAgentRunRequestContext(options: {
  event: H3Event;
  ownerContext: AgentRunOwnerContext;
  resolveOrgId?: OrgIdResolver;
  isBackgroundWorker?: boolean;
}): Promise<RequestContext> {
  const orgId = await resolveAgentRunOrgId(options);
  const timezone = readAgentRunTimezone(options.event);
  return {
    userEmail: options.ownerContext.owner,
    userName: options.ownerContext.name,
    orgId,
    timezone,
    ...(options.isBackgroundWorker
      ? { run: { isBackgroundWorker: true } }
      : {}),
  };
}

export async function runWithAgentRunContext<T>(
  options: {
    event: H3Event;
    ownerContext: AgentRunOwnerContext;
    resolveOrgId?: OrgIdResolver;
    isBackgroundWorker?: boolean;
  },
  fn: () => T | Promise<T>,
): Promise<T> {
  const requestContext = await resolveAgentRunRequestContext(options);
  return await runWithRequestContext(requestContext, fn);
}
