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
