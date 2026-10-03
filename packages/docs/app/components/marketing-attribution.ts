import {
  getFirstTouchAttribution,
  type FirstTouchAttribution,
} from "@agent-native/core/client/analytics";

const FIRST_TOUCH_HANDOFF_FIELDS = [
  "ref",
  "via",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const satisfies ReadonlyArray<keyof FirstTouchAttribution>;

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
 */
export function appendSiteHandoff(
  targetUrl: string,
  attribution: FirstTouchAttribution | null,
  currentPath: string,
): string {
  const withCampaign = appendFirstTouchAttribution(targetUrl, attribution);
  try {
    const url = new URL(withCampaign);
    const siteFields: Array<[string, string | undefined]> = [
      ["site_referrer", attribution?.landing_referrer],
      ["site_landing_path", attribution?.landing_path || currentPath],
    ];
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
 */
export function installAppLinkAttribution(target: Document = document) {
  const decorate = (event: Event) => {
    const element = event.target instanceof Element ? event.target : null;
    const link = element?.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    if (!isFirstPartyAppHost(link.hostname)) return;
    const nextUrl = appendSiteHandoff(
      link.href,
      getFirstTouchAttribution(),
      window.location.pathname,
    );
    if (nextUrl !== link.href) link.href = nextUrl;
  };

  // Both phases: capture still runs when a handler stops propagation, and
  // bubble runs after handlers that rebuild `href` on click (SlidesTryNow).
  // Decorating is idempotent. `auxclick` covers middle-click; context-menu
  // copies are left alone so a copied link never carries this visitor's
  // source to someone else.
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
