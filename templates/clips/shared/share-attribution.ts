/**
 * Viral attribution contract for shared Clips links.
 *
 * Shared clip URLs self-attribute so the signup funnel can be measured even
 * when `document.referrer` is empty (desktop app, Slack, native clients, etc.).
 * The framework captures first-touch from these params into a cookie and
 * enriches the `signup` event; Clips' job is to (a) tag share/embed URLs and
 * (b) emit funnel events from the public share page.
 *
 * Contract strings are centralized here so the minting side (share dialog) and
 * the measuring side (public share page) cannot drift apart.
 *
 * Privacy: `via` must be a non-PII stable id (e.g. the owner's user id), never
 * an email. Omit `via` rather than leak PII into a public URL or event.
 */

/** Fixed referral source for clip shares. */
export const CLIP_SHARE_REF = "clip_share";

export const REF_PARAM = "ref";
export const VIA_PARAM = "via";

export function withShareAttribution(
  url: string,
  ownerId?: string | null,
): string {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(REF_PARAM, CLIP_SHARE_REF);
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

export function buildShareContinuationQuery(
  attribution: ShareAttribution,
  startAt?: string | null,
  panel?: string | null,
): string {
  const params = new URLSearchParams();
  if (attribution.ref) params.set(REF_PARAM, attribution.ref);
  if (attribution.via) params.set(VIA_PARAM, attribution.via);
  if (startAt) params.set("at", startAt);
  if (panel) params.set("panel", panel);
  return params.toString();
}

export function readShareAttribution(search: string): ShareAttribution {
  let ref: string | undefined;
  let via: string | undefined;
  try {
    const params = new URLSearchParams(search ?? "");
    ref = params.get(REF_PARAM) ?? undefined;
    via = params.get(VIA_PARAM) ?? undefined;
  } catch {
    // Ignore malformed query strings — fall through to the default below.
  }
  return { ref: ref || CLIP_SHARE_REF, via: via || undefined };
}

export function buildSignupAttributionQuery(via?: string | null): string {
  const params = new URLSearchParams();
  params.set(REF_PARAM, CLIP_SHARE_REF);
  const owner = (via ?? "").trim();
  if (owner) params.set(VIA_PARAM, owner);
  return params.toString();
}
