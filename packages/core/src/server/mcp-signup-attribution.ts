import crypto from "node:crypto";

import { normalizeAnalyticsAnonymousId } from "../shared/analytics-anonymous-id.js";
import { normalizeAnalyticsSessionId } from "../shared/analytics-session-id.js";
import { CONSENT_COOKIE_NAME, parseConsent } from "../shared/consent.js";
import { parseCookieHeader } from "./attribution.js";

export const MCP_SIGNUP_ATTRIBUTION_COOKIE_NAME = "an_mcp_signup";
export const MCP_SIGNUP_ATTRIBUTION_TTL_SECONDS = 30 * 60;

export interface McpSignupAttribution {
  signupOrigin?: "mcp_oauth";
  /** Legacy signed-cookie field; interpreted only as an unverified hint. */
  vendor?: string;
  vendorHint?: string;
  anonymousId?: string;
  sessionId?: string;
  firstTouchPathAllowed?: boolean;
}

export function applyMcpSignupAttribution(
  attribution: Record<string, string | undefined> | undefined,
  mcpSignup: McpSignupAttribution | null | undefined,
): Record<string, string | undefined> | undefined {
  if (!mcpSignup) return attribution;
  const vendorHint = normalizeVendor(mcpSignup.vendorHint ?? mcpSignup.vendor);
  const result = {
    ...(attribution ?? {}),
    ...(mcpSignup.firstTouchPathAllowed === true &&
    !attribution?.first_touch_path
      ? { first_touch_path: "/mcp/oauth/authorize" }
      : {}),
    ...(vendorHint ? { $mcp_vendor_client_hint: vendorHint } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

interface McpSignupAttributionPayload extends McpSignupAttribution {
  version: 1;
  expiresAt: number;
}

function normalizeVendor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const vendor = value.trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,31}$/.test(vendor) ? vendor : undefined;
}

export function sanitizeMcpSignupAttribution(
  value: unknown,
): McpSignupAttribution | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const vendorHint = normalizeVendor(record.vendorHint ?? record.vendor);
  const signupOrigin =
    record.signupOrigin === "mcp_oauth" ? "mcp_oauth" : undefined;
  const anonymousId = normalizeAnalyticsAnonymousId(record.anonymousId);
  const sessionId = normalizeAnalyticsSessionId(record.sessionId);
  if (!signupOrigin && !vendorHint && !anonymousId && !sessionId) {
    return undefined;
  }
  return {
    ...(signupOrigin ? { signupOrigin } : {}),
    ...(vendorHint ? { vendorHint } : {}),
    ...(anonymousId ? { anonymousId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(typeof record.firstTouchPathAllowed === "boolean"
      ? { firstTouchPathAllowed: record.firstTouchPathAllowed }
      : {}),
  };
}

export function encodeMcpSignupAttribution(
  value: McpSignupAttribution,
  secret: string,
  now = Date.now(),
): string | undefined {
  if (!secret) return undefined;
  const attribution = sanitizeMcpSignupAttribution(value);
  if (!attribution) return undefined;

  const payload: McpSignupAttributionPayload = {
    version: 1,
    expiresAt: Math.floor(now / 1000) + MCP_SIGNUP_ATTRIBUTION_TTL_SECONDS,
    ...attribution,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

export function decodeMcpSignupAttribution(
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
): McpSignupAttribution | null | undefined {
  if (token === null || token === undefined) return undefined;
  if (!token || !secret || token.length > 1024) return null;

  try {
    const delimiter = token.lastIndexOf(".");
    if (delimiter <= 0 || delimiter === token.length - 1) return null;
    const data = token.slice(0, delimiter);
    const signature = token.slice(delimiter + 1);
    const expected = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest("base64url");
    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(data, "base64url").toString("utf8"),
    ) as Partial<McpSignupAttributionPayload>;
    if (
      payload.version !== 1 ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt < Math.floor(now / 1000)
    ) {
      return null;
    }
    return sanitizeMcpSignupAttribution(payload) ?? null;
  } catch {
    // coercion-ok: malformed signed attribution is a distinct invalid value.
    return null;
  }
}

export function readMcpSignupAttributionFromCookieHeader(
  cookieHeader: string | null | undefined,
  secret: string,
  now = Date.now(),
): McpSignupAttribution | null | undefined {
  const cookie = Object.entries(parseCookieHeader(cookieHeader)).find(
    ([name]) => name === MCP_SIGNUP_ATTRIBUTION_COOKIE_NAME,
  );
  return cookie
    ? decodeMcpSignupAttribution(cookie[1], secret, now)
    : undefined;
}

export function hasMcpSignupAttributionCookie(
  cookieHeader: string | null | undefined,
): boolean {
  return Boolean(
    parseCookieHeader(cookieHeader)[MCP_SIGNUP_ATTRIBUTION_COOKIE_NAME],
  );
}

export function readMcpSignupContextFromCookieHeader(
  cookieHeader: string | null | undefined,
  secret: string,
  now = Date.now(),
): McpSignupAttribution | null | undefined {
  return filterMcpSignupAttributionByConsent(
    readMcpSignupAttributionFromCookieHeader(cookieHeader, secret, now),
    cookieHeader,
  );
}

export function filterMcpSignupAttributionByConsent(
  context: McpSignupAttribution | null | undefined,
  cookieHeader: string | null | undefined,
): McpSignupAttribution | null | undefined {
  if (!context) return context;

  const consent = parseConsent(
    parseCookieHeader(cookieHeader)[CONSENT_COOKIE_NAME],
  );
  const allowedContext = { ...context };
  if (consent?.performance === false) {
    delete allowedContext.anonymousId;
    delete allowedContext.sessionId;
  }
  if (consent?.targeting === false) {
    delete allowedContext.vendor;
    delete allowedContext.vendorHint;
    allowedContext.firstTouchPathAllowed = false;
  }
  return allowedContext;
}

export function serializeMcpSignupAttributionCookie(
  attribution: McpSignupAttribution,
  secret: string,
  secure: boolean,
  now = Date.now(),
): string | undefined {
  const token = encodeMcpSignupAttribution(attribution, secret, now);
  if (!token) return undefined;
  return (
    `${MCP_SIGNUP_ATTRIBUTION_COOKIE_NAME}=${token}; ` +
    `Max-Age=${MCP_SIGNUP_ATTRIBUTION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax` +
    (secure ? "; Secure" : "")
  );
}
