import { hasNativeWebMcpHost } from "./VisualEditWebMcp";

export const NO_SELECTORS: string[] = [];

export function previewUrlAtLiveRoute(
  previewUrl: string | undefined,
  routePath: string | undefined,
): string | undefined {
  if (!previewUrl || !routePath) return previewUrl;
  try {
    const base = new URL(previewUrl);
    const route = new URL(routePath, base.origin);
    if (route.origin !== base.origin) return previewUrl;
    base.pathname = route.pathname;
    base.search = route.search;
    base.hash = route.hash;
    return base.toString();
  } catch {
    return previewUrl;
  }
}

export function pageHasWebMcpHost(): boolean {
  return hasNativeWebMcpHost();
}
