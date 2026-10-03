import {
  getFirstTouchAttribution,
  getLastTouchAttribution,
  type FirstTouchAttribution,
  type LastTouchAttribution,
} from "@agent-native/core/client/analytics";

const FIRST_TOUCH_HANDOFF_FIELDS = [
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
] as const satisfies ReadonlyArray<keyof FirstTouchAttribution>;

// The app reads these back as its last touch; see `readForwardedLastTouch`.
const LAST_TOUCH_HANDOFF_FIELDS = [
  ["last_ref", "ref"],
  ["last_via", "via"],
  ["last_utm_source", "utm_source"],
  ["last_utm_medium", "utm_medium"],
  ["last_utm_campaign", "utm_campaign"],
  ["last_utm_content", "utm_content"],
  ["last_referrer", "landing_referrer"],
] as const satisfies ReadonlyArray<
  readonly [string, keyof LastTouchAttribution]
>;

const MARKETING_HOSTS = new Set([
  "agent-native.com",
  "www.agent-native.com",
  "beta.agent-native.com",
]);

export function appendFirstTouchAttribution(
  targetUrl: string,
  attribution: FirstTouchAttribution | null = getFirstTouchAttribution(),
): string {
  if (!attribution) return targetUrl;

  try {
    const url = new URL(targetUrl);
    for (const field of FIRST_TOUCH_HANDOFF_FIELDS) {
      const value = attribution[field];
      if (value && !url.searchParams.has(field)) {
        url.searchParams.set(field, value);
      }
    }
    return url.toString();
  } catch {
    return targetUrl;
  }
}

export function applyFirstTouchAttributionToLink(
  link: HTMLAnchorElement,
): void {
  const nextUrl = appendFirstTouchAttribution(link.href);
  if (nextUrl !== link.href) link.href = nextUrl;
}

export function isFirstPartyAppHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return host.endsWith(".agent-native.com") && !MARKETING_HOSTS.has(host);
}

/**
 * The app's own first touch only sees this site, and our app buttons send no
 * referrer, so forward where the visitor reached the site from and the page
 * they landed on. `site_landing_path` is always set: it marks the signup as
 * having come through the site even when the visitor had no source here.
 *
 * When the visitor's latest sourced visit to the site is a later one than
 * their first, forward it too as `last_*`, so the app credits what brought
 * them back.
 */
export function appendSiteHandoff(
  targetUrl: string,
  attribution: FirstTouchAttribution | null,
  currentPath: string,
  lastTouch: LastTouchAttribution | null = null,
): string {
  const withCampaign = appendFirstTouchAttribution(targetUrl, attribution);
  try {
    const url = new URL(withCampaign);
    const siteFields: Array<[string, string | undefined]> = [
      ["site_referrer", attribution?.landing_referrer],
      ["site_landing_path", attribution?.landing_path || currentPath],
    ];
    if (lastTouch && lastTouch.touched_at !== attribution?.landed_at) {
      for (const [param, field] of LAST_TOUCH_HANDOFF_FIELDS) {
        siteFields.push([param, lastTouch[field]]);
      }
    }
    for (const [field, value] of siteFields) {
      if (value && !url.searchParams.has(field)) {
        url.searchParams.set(field, value);
      }
    }
    return url.toString();
  } catch {
    return withCampaign;
  }
}

/**
 * Decorate every link into an app at the moment it is followed, so links in
 * docs content, shared components, and future pages carry the visitor's
 * source without each one remembering to.
 *
 * The browser reads `href` when the click's default action runs, right after
 * every listener. The clean `href` comes back on the next task, so copying
 * the link later never hands this visitor's source to someone else.
 */
export function installAppLinkAttribution(target: Document = document) {
  const decorate = (event: Event) => {
    // Primary click (also Enter on a focused link) or middle click. Other
    // buttons open menus, not the link.
    const button = event instanceof MouseEvent ? event.button : 0;
    if (button !== (event.type === "auxclick" ? 1 : 0)) return;
    const element = event.target instanceof Element ? event.target : null;
    const link = element?.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    if (!isFirstPartyAppHost(link.hostname)) return;
    const cleanUrl = link.href;
    const nextUrl = appendSiteHandoff(
      cleanUrl,
      getFirstTouchAttribution(),
      window.location.pathname,
      getLastTouchAttribution(),
    );
    if (nextUrl === cleanUrl) return;
    link.href = nextUrl;
    setTimeout(() => {
      // Undo only our own change: a handler may have rebuilt the link since.
      if (link.href === nextUrl) link.href = cleanUrl;
    });
  };

  // Both phases: capture still runs when a handler stops propagation, and
  // bubble runs after handlers that rebuild `href` on click (SlidesTryNow).
  // Decorating is idempotent. `auxclick` covers middle-click.
  const listeners = ["click", "auxclick"].flatMap((type) =>
    [true, false].map((capture) => ({ type, capture })),
  );
  for (const { type, capture } of listeners) {
    target.addEventListener(type, decorate, capture);
  }
  return () => {
    for (const { type, capture } of listeners) {
      target.removeEventListener(type, decorate, capture);
    }
  };
}
