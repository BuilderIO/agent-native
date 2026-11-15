import { FIRST_RUN_ONBOARDING_COOKIE } from "@agent-native/core/shared/first-run-onboarding";

/**
 * Set on <html> before the first paint while the first-run cookie says
 * onboarding may start. The SSR shell is shared by every visitor, so a
 * first-paint home is swapped for a plain skeleton by CSS keyed to this
 * attribute, never by rendering a different tree.
 */
export const FIRST_RUN_PENDING_ATTRIBUTE =
  "data-agent-native-first-run-pending";

export function getFirstRunFirstPaintScriptBody(): string {
  const entry = JSON.stringify(`${FIRST_RUN_ONBOARDING_COOKIE}=1`);
  const attribute = JSON.stringify(FIRST_RUN_PENDING_ATTRIBUTE);
  // An unreadable cookie leaves the attribute unset, which is what the startup
  // gate does with one too: it skips first run (and logs why).
  // coercion-ok: an inline pre-paint script has no caller to report to.
  return `(function(){try{if(document.cookie.split(";").some(function(c){return c.trim()===${entry}}))document.documentElement.setAttribute(${attribute},"")}catch(_){}})();`;
}

export function clearFirstRunFirstPaint(): void {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute(FIRST_RUN_PENDING_ATTRIBUTE);
}
