import { resolveAppBasePath } from "./api-path.js";
import { getFrameOrigin, isKnownFrameHostOrigin } from "./frame.js";

export const SCREEN_SETTLED_EVENT = "agent-native:screen-settled";

const recentlySettled = new Set<string>();

export function postScreenSettled({
  writeId,
  url,
  tabId,
}: {
  writeId: string;
  url: string;
  tabId: string;
}): void {
  const key = `${tabId}:${writeId}`;
  if (recentlySettled.has(key)) return;
  recentlySettled.add(key);
  if (recentlySettled.size > 256) {
    const oldest = recentlySettled.values().next();
    if (!oldest.done) recentlySettled.delete(oldest.value);
  }
  const safeUrl = new URL(url, "https://app.invalid");
  safeUrl.searchParams.delete("__an_embed_token");
  const route = safeUrl.pathname + safeUrl.search + safeUrl.hash;
  const detail = {
    type: SCREEN_SETTLED_EVENT,
    writeId,
    tabId,
    appBasePath: resolveAppBasePath(),
    url: route,
    screenSummary: { title: document.title, route },
  };
  window.dispatchEvent(new CustomEvent(SCREEN_SETTLED_EVENT, { detail }));
  const parentOrigin = getFrameOrigin() ?? window.location.origin;
  if (window.parent !== window && isKnownFrameHostOrigin(parentOrigin)) {
    window.parent.postMessage(detail, parentOrigin);
  }
}
