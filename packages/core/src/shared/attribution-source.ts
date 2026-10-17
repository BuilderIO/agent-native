/**
 * Whether a visit says where the person came from. The browser uses this to
 * decide which visits to keep as first and last touch, and the server uses the
 * same share-link rules to derive `referral_source`, so the two can't drift.
 */
export interface AttributionTouch {
  ref?: string;
  via?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  msclkid?: string;
  vector_source?: string;
  landing_path?: string;
  landing_referrer?: string;
  site_referrer?: string;
}

const TAG_FIELDS = [
  "ref",
  "via",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "msclkid",
  "vector_source",
] as const satisfies ReadonlyArray<keyof AttributionTouch>;

const PLAN_SHARE_PATH_SEGMENTS = [
  "/p/",
  "/plan/",
  "/plans/",
  "/recaps/",
  "/share-plan/",
];

export function shareLandingSource(
  path: string | undefined,
): "clip_share" | "plan_share" | undefined {
  if (!path) return undefined;
  if (path.startsWith("/share/")) return "clip_share";
  if (PLAN_SHARE_PATH_SEGMENTS.some((segment) => path.includes(segment))) {
    return "plan_share";
  }
  return undefined;
}

export function isFirstPartyHost(host: string | undefined): boolean {
  const normalized = host?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  return (
    normalized === "agent-native.com" ||
    normalized.endsWith(".agent-native.com")
  );
}

// Coming back from Google sign-in sends this referrer. It's a step in signing
// in, never where someone heard about us.
const SIGN_IN_HOSTS = new Set(["accounts.google.com"]);

// A developer's own machine, with or without a port.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * Whether a referrer host says where someone came from. Moving between our own
 * apps and the marketing site, a local dev server, or returning from Google
 * sign-in is navigation, not a source. The browser and the server both use
 * this, so capture and `referral_source` agree.
 */
export function isSourceReferrerHost(host: string | undefined): boolean {
  const normalized = host?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  if (!normalized) return false;
  const hostname = normalized.startsWith("[")
    ? normalized.slice(0, normalized.indexOf("]") + 1)
    : normalized.split(":")[0];
  return (
    !isFirstPartyHost(hostname) &&
    !LOCAL_HOSTS.has(hostname) &&
    !SIGN_IN_HOSTS.has(hostname)
  );
}

export function hasAttributionSource(
  touch: AttributionTouch | null | undefined,
): boolean {
  if (!touch) return false;
  if (TAG_FIELDS.some((field) => !!touch[field]?.trim())) return true;
  if (shareLandingSource(touch.landing_path)) return true;
  return [touch.landing_referrer, touch.site_referrer].some(
    isSourceReferrerHost,
  );
}
