/**
 * Viral-attribution helper for framework "share URL" builders.
 *
 * Public share/copy links self-attribute so the signup funnel can be measured
 * even when `document.referrer` is empty (desktop app, Slack, native clients,
 * etc). `server/attribution.ts` captures first-touch `ref`/`via` query params
 * into a cookie and enriches the `signup` event; each app's only job is to
 * tag the share URL it mints when building it — the framework does the rest.
 *
 * Centralized here (rather than reimplemented per app) so every share-link
 * builder tags the same two params the same way. `ref` is always required so
 * an app's share path isn't silently miscategorized by the landing-path
 * fallback in `deriveReferralSource` (e.g. `/share/...` defaults to
 * "clip_share" for any app that happens to use that prefix).
 *
 * Privacy: `ownerId` must be a non-PII stable id — the same Better Auth user
 * id `signup` events carry as `auth_user_id` (e.g. `session.userId` from
 * `useSession()`) — never an email or name. Omit it for a logged-out sharer
 * rather than emit an empty `via`.
 */

export const SHARE_LINK_REF_PARAM = "ref";
export const SHARE_LINK_VIA_PARAM = "via";

/**
 * Append `ref=<source>` (and `via=<ownerId>` when a non-empty id is given) to
 * an absolute share URL, preserving any existing query params. Returns the
 * input unchanged when it isn't a parseable absolute URL, including
 * `undefined` — so callers can feed in a share URL that isn't minted yet.
 */
export function withShareLinkAttribution(
  url: string | undefined,
  source: string,
  ownerId?: string | null,
): string | undefined {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(SHARE_LINK_REF_PARAM, source);
    const owner = (ownerId ?? "").trim();
    if (owner) parsed.searchParams.set(SHARE_LINK_VIA_PARAM, owner);
    return parsed.toString();
  } catch {
    return url;
  }
}
