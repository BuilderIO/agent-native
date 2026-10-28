import { hasSessionHint } from "@agent-native/core/client/use-session";
import {
  safeJsonForHtml,
  signInJourney,
  signInJourneyInlineScript,
} from "@agent-native/core/shared";

export const PRIVATE_LINK_REDIRECT_ATTRIBUTE =
  "data-content-private-link-redirect";

// Tailwind only finds whole class strings, so the attribute is spelled out
// here; a test keeps it equal to PRIVATE_LINK_REDIRECT_ATTRIBUTE.
export const HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS =
  "[html[data-content-private-link-redirect]_&]:invisible";

export const PRIVATE_LINK_ATTEMPT_KEY_PREFIX = "content-private-link-attempt:";

export const PRIVATE_LINK_ATTEMPT_WINDOW_MS = 30_000;

// Same rule as core's hasSessionHint, for the inline script that runs before
// any module loads.
const SESSION_HINT_EXPRESSION = `document.cookie.split(";").some(function(c){c=c.trim();var i=c.indexOf("=");if(i<1||c.slice(i+1)!=="1")return false;var n=c.slice(0,i);return n==="an_session_hint"||(n.indexOf("an_session_")===0&&n.slice(-5)==="_hint");})`;

// Every visitor gets the same cached share page, so it can't know whether this
// browser may open the document. Browsers leave before first paint: one with a
// session hint goes to the app page, which opens the document or says why it
// can't; one without goes straight to sign-in with the app page as the way
// back, because a signed-out app page sends its visitor here. A hint can
// outlive its session or belong to another app on the same host, and then the
// app page sends the visitor straight back, so a browser follows the hint to a
// page once per window and goes to sign-in when it returns inside it. Sign-in
// sends a visitor who does have a session on to the page. The query and hash
// ride along to both, since the editor link that sent the visitor here may
// carry them. The private notice is for fetchers that don't run scripts.
export function privateDocumentRedirectScript(
  pageHref: string,
  basePath: string,
) {
  const page = safeJsonForHtml(pageHref);
  return `document.documentElement.setAttribute(${JSON.stringify(
    PRIVATE_LINK_REDIRECT_ATTRIBUTE,
  )},"");(function(){${signInJourneyInlineScript()}var page=${page}+location.search+location.hash;var signIn=__anCreateSignInJourney(${safeJsonForHtml(
    basePath,
  )}).signInJourney({at:page}).signInHref||page;var follow=false;if(${SESSION_HINT_EXPRESSION}){try{var key=${safeJsonForHtml(
    PRIVATE_LINK_ATTEMPT_KEY_PREFIX,
  )}+${page};var now=Date.now();if(now-Number(sessionStorage.getItem(key))<${PRIVATE_LINK_ATTEMPT_WINDOW_MS}){sessionStorage.removeItem(key);}else{sessionStorage.setItem(key,String(now));follow=true;}}catch(e){follow=false;}}location.replace(follow?page:signIn);})();`;
}

// Whether to follow the session hint to the page this time. Without storage
// there's no way to tell a second visit from a first, so it goes to sign-in.
function followSessionHint(pageHref: string): boolean {
  if (!hasSessionHint()) return false;
  try {
    const key = `${PRIVATE_LINK_ATTEMPT_KEY_PREFIX}${pageHref}`;
    const now = Date.now();
    if (
      now - Number(window.sessionStorage.getItem(key)) <
      PRIVATE_LINK_ATTEMPT_WINDOW_MS
    ) {
      window.sessionStorage.removeItem(key);
      return false;
    }
    window.sessionStorage.setItem(key, String(now));
    return true;
  } catch {
    // coercion-ok: blocked storage can't tell a return visit from a first one, so sign-in is the answer.
    return false;
  }
}

// Where the script would go, for the effect that covers a page the script
// didn't run on.
export function privateDocumentRedirectHref(
  pageHref: string,
  basePath: string,
) {
  const { search, hash } = window.location;
  const page = `${pageHref}${search}${hash}`;
  const signIn = signInJourney({ at: page, basePath }).signInHref ?? page;
  return followSessionHint(pageHref) ? page : signIn;
}

// The script has already started the move, and starting it again cancels the
// request in flight.
export function privateLinkRedirectStarted() {
  return document.documentElement.hasAttribute(PRIVATE_LINK_REDIRECT_ATTRIBUTE);
}
