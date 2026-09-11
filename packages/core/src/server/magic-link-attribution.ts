import crypto from "node:crypto";

import { normalizeAnalyticsAnonymousId } from "../shared/analytics-anonymous-id.js";

/** Query parameter carried by Better Auth's new-user callback URL. */
export const MAGIC_LINK_ATTRIBUTION_PARAM = "signup_attribution";

/** Better Auth's magic-link token is valid for five minutes; keep this handoff
 * slightly longer so clock skew does not discard a still-valid link. */
const MAGIC_LINK_ATTRIBUTION_TTL_SECONDS = 10 * 60;
const MAX_ATTRIBUTION_FIELDS = 32;
const MAX_ATTRIBUTION_VALUE_LENGTH = 200;

export interface MagicLinkSignupAttribution {
  attribution?: Record<string, string>;
  anonymousId?: string;
}

interface MagicLinkAttributionPayload extends MagicLinkSignupAttribution {
  exp: number;
}

function sanitizeAttribution(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value).slice(
    0,
    MAX_ATTRIBUTION_FIELDS,
  )) {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
      typeof raw !== "string" ||
      raw.length === 0
    ) {
      continue;
    }
    out[key] = raw.slice(0, MAX_ATTRIBUTION_VALUE_LENGTH);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function encodePayload(payload: MagicLinkAttributionPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * Sign the attribution captured when a magic link is requested. The token is
 * analytics context only; it never authorizes the user or changes the return
 * URL. The Better Auth secret keeps the callback from accepting forged data.
 */
export function encodeMagicLinkSignupAttribution(
  value: MagicLinkSignupAttribution,
  secret: string,
  now = Date.now(),
): string | undefined {
  if (!secret) return undefined;

  const attribution = sanitizeAttribution(value.attribution);
  const anonymousId = normalizeAnalyticsAnonymousId(value.anonymousId);
  if (!attribution && !anonymousId) return undefined;

  const payload: MagicLinkAttributionPayload = {
    exp: Math.floor(now / 1000) + MAGIC_LINK_ATTRIBUTION_TTL_SECONDS,
    ...(attribution ? { attribution } : {}),
    ...(anonymousId ? { anonymousId } : {}),
  };
  const data = encodePayload(payload);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

/** Verify and decode a token previously produced by
 * {@link encodeMagicLinkSignupAttribution}. */
export function decodeMagicLinkSignupAttribution(
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
): MagicLinkSignupAttribution | null | undefined {
  if (token === null || token === undefined) return undefined;
  if (!token || !secret) return null;

  try {
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex <= 0 || dotIndex === token.length - 1) return null;

    const data = token.slice(0, dotIndex);
    const signature = token.slice(dotIndex + 1);
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
    ) as Partial<MagicLinkAttributionPayload>;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(now / 1000)
    ) {
      return null;
    }

    const attribution = sanitizeAttribution(payload.attribution);
    const anonymousId = normalizeAnalyticsAnonymousId(payload.anonymousId);
    if (!attribution && !anonymousId) return undefined;
    return {
      ...(attribution ? { attribution } : {}),
      ...(anonymousId ? { anonymousId } : {}),
    };
  } catch {
    // coercion-ok: malformed signed input is distinct from absent context.
    return null;
  }
}

/**
 * Read the signed handoff from Better Auth's magic-link verification request.
 * Better Auth copies `newUserCallbackURL` into the verification URL, so this
 * remains available even when the link is opened on another device.
 */
export function readMagicLinkSignupAttribution(
  requestUrl: string | undefined,
  secret: string,
  now = Date.now(),
): MagicLinkSignupAttribution | null | undefined {
  if (!requestUrl) return undefined;

  try {
    const verificationUrl = new URL(requestUrl, "http://localhost");
    if (!verificationUrl.pathname.endsWith("/magic-link/verify")) {
      return undefined;
    }
    const callback = verificationUrl.searchParams.get("newUserCallbackURL");
    if (!callback) return undefined;

    const callbackUrl = new URL(callback, verificationUrl.origin);
    return decodeMagicLinkSignupAttribution(
      callbackUrl.searchParams.get(MAGIC_LINK_ATTRIBUTION_PARAM),
      secret,
      now,
    );
  } catch {
    // coercion-ok: malformed request input is distinct from absent context.
    return null;
  }
}
