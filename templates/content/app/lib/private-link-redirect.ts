import { safeJsonForHtml } from "@agent-native/core/shared";

export const PRIVATE_LINK_REDIRECT_ATTRIBUTE =
  "data-content-private-link-redirect";

// Tailwind only finds whole class strings, so the attribute is spelled out
// here; a test keeps it equal to PRIVATE_LINK_REDIRECT_ATTRIBUTE.
export const HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS =
  "[html[data-content-private-link-redirect]_&]:invisible";

// Every visitor gets the same cached share page, so it can't know whether this
// browser may open the document. Browsers leave for the app page before first
// paint, which opens the document or says why it can't; the private notice is
// for fetchers that don't run scripts.
export function privateDocumentRedirectScript(pageHref: string) {
  return `document.documentElement.setAttribute(${JSON.stringify(
    PRIVATE_LINK_REDIRECT_ATTRIBUTE,
  )},"");location.replace(${safeJsonForHtml(pageHref)});`;
}

// The script has already started the move, and starting it again cancels the
// request in flight.
export function privateLinkRedirectStarted() {
  return document.documentElement.hasAttribute(PRIVATE_LINK_REDIRECT_ATTRIBUTE);
}
