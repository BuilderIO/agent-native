import crypto from "node:crypto";

import type { H3Event } from "h3";

import { EMBED_START_PATH } from "../shared/embed-auth.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import { resolveEmbedRequestOrigin } from "./embed-request-origin.js";
import {
  createEmbedSessionTicket,
  normalizeEmbedTargetPath,
} from "./embed-session.js";

export const EMBED_HANDOFF_QUERY_PARAM = "handoff";

const EMBED_HANDOFF_SCOPE = "embed-handoff";
const EMBED_HANDOFF_TTL_SECONDS = 120;
const EMBED_HANDOFF_CLOCK_SKEW_SECONDS = 30;

function embedStartAudience(appUrl: string): string {
  const url = new URL(appUrl);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}${EMBED_START_PATH}`;
}

/**
 * Builds a start URL on another workspace app that opens `targetPath` there as
 * `ownerEmail`. Workspace apps may keep separate databases, so the caller
 * cannot write the target's ticket; it signs a single-use handoff with the
 * workspace A2A secret and the target mints its own ticket from it.
 */
export async function createEmbedHandoffStartUrl(input: {
  targetAppUrl: string;
  targetPath: string;
  ownerEmail: string;
  orgId?: string | null | undefined;
  chrome?: string | null | undefined;
}): Promise<{ startUrl: string; expiresAt: number } | null> {
  const { getGlobalA2ASecret, signA2AToken } = await import("../a2a/client.js");
  if (!getGlobalA2ASecret()) return null;
  const audience = embedStartAudience(input.targetAppUrl);
  const token = await signA2AToken(input.ownerEmail, undefined, undefined, {
    preferGlobalSecret: true,
    audience,
    expiresIn: `${EMBED_HANDOFF_TTL_SECONDS}s`,
    extraClaims: {
      scope: EMBED_HANDOFF_SCOPE,
      jti: crypto.randomUUID(),
      embed_target: input.targetPath,
      ...(input.chrome ? { embed_chrome: input.chrome } : {}),
      ...(input.orgId ? { embed_org_id: input.orgId } : {}),
    },
  });
  const startUrl = new URL(audience);
  startUrl.searchParams.set(EMBED_HANDOFF_QUERY_PARAM, token);
  return {
    startUrl: startUrl.toString(),
    expiresAt: Date.now() + EMBED_HANDOFF_TTL_SECONDS * 1000,
  };
}

/**
 * Exchanges a handoff from a sibling workspace app for a local embed ticket.
 * Returns null for anything that is not a fresh, unused handoff addressed to
 * this app's embed start route.
 */
export async function embedTicketFromHandoff(
  event: H3Event,
  handoff: string,
): Promise<string | null> {
  const audienceHost = resolveEmbedRequestOrigin(event);
  const expectedAudience = `${audienceHost}${getConfiguredAppBasePath()}${EMBED_START_PATH}`;
  const { verifyA2AToken } = await import("../a2a/server.js");
  let verified: Awaited<ReturnType<typeof verifyA2AToken>>;
  try {
    verified = await verifyA2AToken(handoff, event, {
      expectedAudience,
      requireAudience: true,
      globalSecretOnly: true,
      includeClaims: true,
    });
  } catch {
    // coercion-ok: an unverifiable handoff is answered with the expired-session page.
    return null;
  }
  const claims = verified.claims;
  const ownerEmail = verified.email?.trim();
  if (!claims || !ownerEmail || verified.orgDomain || verified.orgId)
    return null;
  if (claims.scope !== EMBED_HANDOFF_SCOPE) return null;
  if (typeof claims.jti !== "string" || !claims.jti) return null;
  if (
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number" ||
    claims.exp - claims.iat > EMBED_HANDOFF_TTL_SECONDS ||
    claims.iat > Date.now() / 1000 + EMBED_HANDOFF_CLOCK_SKEW_SECONDS
  ) {
    return null;
  }
  const targetPath = normalizeEmbedTargetPath(
    typeof claims.embed_target === "string" ? claims.embed_target : null,
  );
  if (!targetPath) return null;
  const chrome =
    claims.embed_chrome === "full" || claims.embed_chrome === "minimal"
      ? claims.embed_chrome
      : null;

  // Org ids are app-local, so the caller's org only carries over when this
  // app's roster has the user in an org with that id.
  let orgId: string | undefined;
  if (typeof claims.embed_org_id === "string" && claims.embed_org_id) {
    const { isOrgMemberForA2A } = await import("../org/membership.js");
    if (await isOrgMemberForA2A(claims.embed_org_id, ownerEmail, event))
      orgId = claims.embed_org_id;
  }

  const { consumeOneTimeJti } = await import("./identity-sso-store.js");
  if (await consumeOneTimeJti(`${EMBED_HANDOFF_SCOPE}:${claims.jti}`))
    return null;

  const ticket = await createEmbedSessionTicket({
    ownerEmail,
    ...(orgId ? { orgId } : {}),
    targetPath,
    scope: chrome,
    audienceHost,
  });
  return ticket.ticket;
}
