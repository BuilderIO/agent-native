import type { H3Event } from "h3";

export const PUBLIC_PATHNAME_CONTEXT_KEY = "_frameworkPublicPathname";

/** The public pathname the browser requested, when the boundary rewrote it. */
export function getPublicFrameworkPathname(event: H3Event): string | undefined {
  const value = event.context?.[PUBLIC_PATHNAME_CONTEXT_KEY];
  return typeof value === "string" ? value : undefined;
}
