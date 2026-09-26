/**
 * Viral attribution contract for shared/public Plan links.
 *
 * Public plan/recap URLs self-attribute so the signup funnel can be measured
 * even when `document.referrer` is empty (desktop app, Slack, native clients,
 * etc.). The framework captures first-touch from these params into a cookie and
 * enriches the `signup` event; Plan's job is to (a) tag the share/public URLs it
 * mints and (b) emit funnel events when a logged-out visitor views a public plan
 * and clicks a sign-up CTA.
 *
 * Contract strings are centralized here so the minting side (share popover /
 * copy-link) and the measuring side (public plan view) cannot drift apart. The
 * framework also derives `plan_share` from public plan paths (`/p/`, `/plan/`,
 * `/plans/`, `/recaps/`, `/share-plan/`) as a fallback when the param is lost.
 *
 * Privacy: `via` must be a non-PII stable id (the owner's user id), never an
 * email. Omit `via` rather than leak PII into a public URL or event.
 */

/** Fixed referral source for plan shares. */
export const PLAN_SHARE_REF = "plan_share";

export const PLAN_SHARE_SURFACE = "plan";

export const REF_PARAM = "ref";
export const VIA_PARAM = "via";

export function withPlanShareAttribution(
  url: string | undefined,
  ownerId?: string | null,
): string | undefined {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(REF_PARAM, PLAN_SHARE_REF);
    const owner = (ownerId ?? "").trim();
    if (owner) parsed.searchParams.set(VIA_PARAM, owner);
    return parsed.toString();
  } catch {
    return url;
  }
}

export type ShareAttribution = {
  ref: string | undefined;
  via: string | undefined;
};

export function readPlanShareAttribution(search: string): ShareAttribution {
  let ref: string | undefined;
  let via: string | undefined;
  try {
    const params = new URLSearchParams(search ?? "");
    ref = params.get(REF_PARAM) ?? undefined;
    via = params.get(VIA_PARAM) ?? undefined;
  } catch {
    // Ignore malformed query strings — fall through to the default below.
  }
  return { ref: ref || PLAN_SHARE_REF, via: via || undefined };
}
