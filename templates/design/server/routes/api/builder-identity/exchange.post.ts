/**
 * Builder → Design identity exchange (spike). See server/lib/builder-identity.ts.
 * Public route: it authenticates the Builder ID token itself.
 */
import {
  createError,
  defineEventHandler,
  getHeader,
  readBody,
  setCookie,
  setResponseHeader,
} from "h3";

import {
  BUILDER_IDENTITY_COOKIE,
  encodeIdentityCookie,
  identityCookieMaxAge,
  isBuilderIdentityEnabled,
  rememberDelegatedCredential,
  verifyBuilderIdToken,
} from "../../../lib/builder-identity.js";

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  if (!isBuilderIdentityEnabled()) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }
  const header = getHeader(event, "authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1];
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "Missing token" });
  }
  let identity;
  try {
    identity = await verifyBuilderIdToken(token);
  } catch (error) {
    throw createError({
      statusCode: 401,
      statusMessage: `Invalid Builder token: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const body = (await readBody(event).catch(() => null)) as {
    spaceId?: unknown;
  } | null;
  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : undefined;
  rememberDelegatedCredential({ ...identity, spaceId }, token);
  setCookie(event, BUILDER_IDENTITY_COOKIE, encodeIdentityCookie({ ...identity, spaceId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: identityCookieMaxAge(),
  });
  return { ok: true, email: identity.email, uid: identity.uid, spaceId };
});
