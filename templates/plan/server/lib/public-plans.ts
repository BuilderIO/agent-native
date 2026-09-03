import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  deleteCookie,
  getCookie,
  getHeader,
  setCookie,
  type H3Event,
} from "h3";

import { getDb, schema } from "../db/index.js";
import { GuestAbuseLimitError, tryConsumeGuestMint } from "./guest-abuse.js";
import {
  GUEST_AUTHOR_DOMAIN,
  getLocalPlanOwnerEmail,
  isGuestAuthorIdentity,
  isLocalPlanRuntime,
} from "./local-identity.js";

const PUBLIC_PLAN_VIEWER_COOKIE = "plan_public_viewer";
const PUBLIC_PLAN_VIEWER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Legacy cookie that pinned a hosted unauthenticated visitor to a stable
 * guest-author identity (`guest-<uuid>@agent-native.guest`). Exported so the
 * claim middleware can still read/clear older cookies.
 */
export const GUEST_AUTHOR_COOKIE = "plan_guest_author";
const GUEST_AUTHOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Re-export so callers (e.g. the claim agent) get the full guest contract from
// this module; the canonical predicate lives in local-identity.ts.
export { isGuestAuthorIdentity };

/** Validate a stored cookie UUID exactly like the public-viewer cookie. */
function isValidCookieUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

/** Build the guest-author email for a validated cookie UUID. */
function guestAuthorEmail(uuid: string): string {
  return `guest-${uuid}@${GUEST_AUTHOR_DOMAIN}`;
}

function getAppOrigin(event: H3Event): string | null {
  const proto =
    getHeader(event, "x-forwarded-proto") ??
    (getHeader(event, "origin")?.startsWith("https://") ? "https" : "http");
  const host = getHeader(event, "x-forwarded-host") ?? getHeader(event, "host");
  if (!host) return null;
  return `${proto}://${host}`;
}

function planIdFromPath(pathname: string): string | null {
  const match = pathname.match(/(?:^|\/)(?:plans|recaps)\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function actionNameFromPath(pathname: string): string | null {
  const match = pathname.match(/(?:^|\/)_agent-native\/actions\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function planIdFromEvent(event: H3Event): string | null {
  const rawUrl = event.node?.req?.url ?? event.path ?? "/";
  try {
    const url = new URL(rawUrl, getAppOrigin(event) ?? "http://localhost");
    const directId =
      url.searchParams.get("id") ?? url.searchParams.get("planId");
    if (directId) return directId;
    const pathId = planIdFromPath(url.pathname);
    if (pathId) return pathId;
  } catch {
    // Fall back to Referer below.
  }

  const referrer = getHeader(event, "referer");
  if (!referrer) return null;

  try {
    const url = new URL(referrer);
    const appOrigin = getAppOrigin(event);
    if (appOrigin && url.origin !== appOrigin) return null;
    return planIdFromPath(url.pathname);
  } catch {
    return null;
  }
}

async function getPublicPlanForEvent(event: H3Event) {
  const id = planIdFromEvent(event);
  if (!id) return null;

  // guard:allow-unscoped -- public review identity only resolves public plans
  // by id and returns no owner data.
  const [plan] = await getDb()
    .select({
      id: schema.plans.id,
      visibility: schema.plans.visibility,
      deletedAt: schema.plans.deletedAt,
    })
    .from(schema.plans)
    .where(eq(schema.plans.id, id))
    .limit(1);

  return plan?.visibility === "public" && !plan.deletedAt ? plan : null;
}

function allowsAnonymousPlanAccessMetadata(event: H3Event): boolean {
  const rawUrl = event.node?.req?.url ?? event.path ?? "/";
  try {
    const url = new URL(rawUrl, getAppOrigin(event) ?? "http://localhost");
    return actionNameFromPath(url.pathname) === "get-plan-access-status";
  } catch {
    return false;
  }
}

/**
 * True when the request's effective protocol is HTTPS, so synthetic-identity
 * cookies get the `Secure` flag on hosted deploys (and stay un-secured on plain
 * http localhost). Mirrors the public-viewer cookie's auto-detect.
 */
function isSecureRequest(event: H3Event): boolean {
  const proto =
    getHeader(event, "x-forwarded-proto") ??
    (getHeader(event, "origin")?.startsWith("https://") ? "https" : "http");
  return proto === "https";
}

/**
 * Anonymous-owner resolver for the plan app.
 *
 * Called by the core auth / core-routes / agent-chat plugins ONLY when there is
 * no authenticated user. Resolution order:
 *
 *   1. Anonymous public-plan viewer — when the request targets a public plan,
 *      mint/return a stable `public-<uuid>@agent-native.local` identity so the
 *      viewer can read (but, per the comment gate, not comment) without an
 *      account. Honored in every environment, hosted and local. Read-only.
 *   2. Local single-user identity — in local mode only (`isLocalPlanRuntime()`),
 *      fall back to the configured local owner so the no-login local workflow
 *      can create, read, list, and edit its own plans without signing in. This
 *      MUST NOT fire on a hosted/production deploy; `isLocalPlanRuntime()`
 *      enforces the production refusal.
 *
 * Returns `null` when none applies, so the caller rejects exactly as before.
 */
export async function resolvePlanAnonymousOwner(
  event: H3Event,
): Promise<string | null> {
  if (allowsAnonymousPlanAccessMetadata(event)) {
    return resolveAnonymousPlanViewerCookie(event);
  }
  const publicViewer = await resolvePublicPlanViewerOwner(event);
  if (publicViewer) return publicViewer;
  return isLocalPlanRuntime() ? getLocalPlanOwnerEmail() : null;
}

export async function resolvePublicPlanViewerOwner(
  event: H3Event,
): Promise<string | null> {
  const plan = await getPublicPlanForEvent(event);
  if (!plan) return null;
  return resolveAnonymousPlanViewerCookie(event);
}

function resolveAnonymousPlanViewerCookie(event: H3Event): string {
  let viewerId = getCookie(event, PUBLIC_PLAN_VIEWER_COOKIE);
  if (!isValidCookieUuid(viewerId)) {
    viewerId = randomUUID();
    setCookie(event, PUBLIC_PLAN_VIEWER_COOKIE, viewerId, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(event),
      path: "/",
      maxAge: PUBLIC_PLAN_VIEWER_COOKIE_MAX_AGE,
    });
  }

  return `public-${viewerId}@agent-native.local`;
}

/**
 * Legacy helper to mint or read the hosted guest-author identity for an
 * unauthenticated request, setting the `plan_guest_author` cookie when minting.
 *
 * Returns `guest-<uuid>@agent-native.guest`. The active anonymous-owner resolver
 * no longer calls this; keep it available for older cookie cleanup/tests.
 *
 * This MUTATES the response (sets a cookie) for new visitors, so do not call it
 * from pure read helpers.
 */
export async function resolvePlanGuestAuthorOwner(
  event: H3Event,
): Promise<string> {
  let guestId = getCookie(event, GUEST_AUTHOR_COOKIE);
  if (!isValidCookieUuid(guestId)) {
    if (!(await tryConsumeGuestMint(event))) {
      throw new GuestAbuseLimitError(
        "Too many guest sessions are being created from this network. Please sign in, or try again shortly.",
      );
    }
    guestId = randomUUID();
    setCookie(event, GUEST_AUTHOR_COOKIE, guestId, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(event),
      path: "/",
      maxAge: GUEST_AUTHOR_COOKIE_MAX_AGE,
    });
  }
  return guestAuthorEmail(guestId);
}

/**
 * Read the current request's guest-author email from the `plan_guest_author`
 * cookie WITHOUT minting or setting anything. Returns
 * `guest-<uuid>@agent-native.guest` when a valid cookie is present, else `null`.
 *
 * Side-effect-free: safe for the claim agent to call to discover which guest
 * identity's plans should be migrated onto the now-authenticated account.
 */
export function readGuestAuthorEmail(event: H3Event): string | null {
  const guestId = getCookie(event, GUEST_AUTHOR_COOKIE);
  return isValidCookieUuid(guestId) ? guestAuthorEmail(guestId) : null;
}

/**
 * Clear the `plan_guest_author` cookie. The claim agent calls this after
 * reassigning a guest's plans to a real account so the now-authenticated visitor
 * stops being pinned to the (drained) guest identity.
 */
export function clearGuestAuthorCookie(event: H3Event): void {
  deleteCookie(event, GUEST_AUTHOR_COOKIE, { path: "/" });
}
