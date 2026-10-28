import { hasSessionHint } from "@agent-native/core/client/use-session";
import { safeJsonForHtml } from "@agent-native/core/shared";

export const PRIVATE_LINK_REDIRECT_ATTRIBUTE =
  "data-content-private-link-redirect";

// Tailwind only finds whole class strings, so the attribute is spelled out
// here; a test keeps it equal to PRIVATE_LINK_REDIRECT_ATTRIBUTE.
export const HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS =
  "[html[data-content-private-link-redirect]_&]:invisible";

// Same rule as core's hasSessionHint, for the inline script that runs before
// any module loads.
const SESSION_HINT_EXPRESSION = `document.cookie.split(";").some(function(c){c=c.trim();var i=c.indexOf("=");if(i<1||c.slice(i+1)!=="1")return false;var n=c.slice(0,i);return n==="an_session_hint"||(n.indexOf("an_session_")===0&&n.slice(-5)==="_hint");})`;

// Every visitor gets the same cached share page, so it can't know whether this
// browser may open the document. Browsers leave before first paint: one with a
// session hint goes to the app page, which opens the document or says why it
// can't; one without goes straight to sign-in with the app page as the way
// back, because a signed-out app page sends its visitor here. The private
// notice is for fetchers that don't run scripts.
export function privateDocumentRedirectScript(
  pageHref: string,
  signInHref: string,
) {
  return `document.documentElement.setAttribute(${JSON.stringify(
    PRIVATE_LINK_REDIRECT_ATTRIBUTE,
  )},"");location.replace(${SESSION_HINT_EXPRESSION}?${safeJsonForHtml(
    pageHref,
  )}:${safeJsonForHtml(signInHref)});`;
}

// Where the script would go, for the effect that covers a page the script
// didn't run on.
export function privateDocumentRedirectHref(
  pageHref: string,
  signInHref: string,
) {
  return hasSessionHint() ? pageHref : signInHref;
}

// The script has already started the move, and starting it again cancels the
// request in flight.
export function privateLinkRedirectStarted() {
  return document.documentElement.hasAttribute(PRIVATE_LINK_REDIRECT_ATTRIBUTE);
}
