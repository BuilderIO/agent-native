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

/** Query param names that carry attribution. */
export const REF_PARAM = "ref";
export const VIA_PARAM = "via";

/**
 * Append `ref=clip_share` (and `via=<ownerId>` when a non-PII owner id is
 * known) to an absolute share/embed URL, preserving any existing query params.
 * Returns the input unchanged when it isn't a parseable absolute URL.
 */
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

/**
 * Read `ref`/`via` from a query string (e.g. `window.location.search`). Falls
 * back to `ref=clip_share` so downstream attribution stays meaningful even when
 * the visitor arrived via a link that lost the param.
 */
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

/**
 * Build the attribution-forwarding signup path so attribution survives even if
 * cookies are blocked. The framework also captures these params on the
 * `/signup` page load.
 */
export function buildSignupAttributionQuery(via?: string | null): string {
  const params = new URLSearchParams();
  params.set(REF_PARAM, CLIP_SHARE_REF);
  const owner = (via ?? "").trim();
  if (owner) params.set(VIA_PARAM, owner);
  return params.toString();
}
