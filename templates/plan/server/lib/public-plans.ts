import { randomUUID } from "node:crypto";
import { getCookie, getHeader, setCookie, type H3Event } from "h3";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import {
  LOCAL_PLAN_OWNER_EMAIL,
  isLocalPlanRuntime,
} from "./local-identity.js";

const PUBLIC_PLAN_VIEWER_COOKIE = "plan_public_viewer";
const PUBLIC_PLAN_VIEWER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function getAppOrigin(event: H3Event): string | null {
  const proto =
    getHeader(event, "x-forwarded-proto") ??
    (getHeader(event, "origin")?.startsWith("https://") ? "https" : "http");
  const host = getHeader(event, "x-forwarded-host") ?? getHeader(event, "host");
  if (!host) return null;
  return `${proto}://${host}`;
}

function planIdFromPath(pathname: string): string | null {
  const match = pathname.match(/(?:^|\/)plans\/([^/?#]+)/);
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
    })
    .from(schema.plans)
    .where(eq(schema.plans.id, id))
    .limit(1);

  return plan?.visibility === "public" ? plan : null;
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
 *      account. Honored in every environment, hosted and local.
 *   2. Local single-user identity — in local mode only (`isLocalPlanRuntime()`),
 *      fall back to `LOCAL_PLAN_OWNER_EMAIL` so the no-login local workflow can
 *      create, read, list, and edit its own plans without signing in. This MUST
 *      NOT fire on a hosted/production deploy; `isLocalPlanRuntime()` enforces
 *      the production refusal.
 *
 * Returns `null` when neither applies (hosted + unauthenticated + not a public
 * plan), so the caller rejects exactly as before.
 */
export async function resolvePlanAnonymousOwner(
  event: H3Event,
): Promise<string | null> {
  const publicViewer = await resolvePublicPlanViewerOwner(event);
  if (publicViewer) return publicViewer;
  if (isLocalPlanRuntime()) return LOCAL_PLAN_OWNER_EMAIL;
  return null;
}

export async function resolvePublicPlanViewerOwner(
  event: H3Event,
): Promise<string | null> {
  const plan = await getPublicPlanForEvent(event);
  if (!plan) return null;

  let viewerId = getCookie(event, PUBLIC_PLAN_VIEWER_COOKIE);
  if (!viewerId || !/^[0-9a-f-]{36}$/i.test(viewerId)) {
    viewerId = randomUUID();
    const proto =
      getHeader(event, "x-forwarded-proto") ??
      (getHeader(event, "origin")?.startsWith("https://") ? "https" : "http");
    setCookie(event, PUBLIC_PLAN_VIEWER_COOKIE, viewerId, {
      httpOnly: true,
      sameSite: "lax",
      secure: proto === "https",
      path: "/",
      maxAge: PUBLIC_PLAN_VIEWER_COOKIE_MAX_AGE,
    });
  }

  return `public-${viewerId}@agent-native.local`;
}
