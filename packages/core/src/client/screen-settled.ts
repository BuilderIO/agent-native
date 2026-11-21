import { getFramePostMessageTargetOrigin } from "./frame.js";

export const SCREEN_SETTLED_EVENT = "agent-native:screen-settled";

const recentlySettled = new Set<string>();

export function postScreenSettled(writeId: string, url: string): void {
  if (recentlySettled.has(writeId)) return;
  recentlySettled.add(writeId);
  if (recentlySettled.size > 256)
    recentlySettled.delete(recentlySettled.values().next().value!);
  const safeUrl = new URL(url, "https://app.invalid");
  safeUrl.searchParams.delete("__an_embed_token");
  const route = safeUrl.pathname + safeUrl.search + safeUrl.hash;
  const detail = {
    type: SCREEN_SETTLED_EVENT,
    writeId,
    url: route,
    screenSummary: { title: document.title, route },
  };
  window.dispatchEvent?.(new CustomEvent(SCREEN_SETTLED_EVENT, { detail }));
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      detail,
      getFramePostMessageTargetOrigin() ?? window.location.origin,
    );
  }
}
