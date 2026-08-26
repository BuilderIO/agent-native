/**
 * The one client-side sign-out.
 *
 * Every surface used to hand-roll the same three steps — POST the logout route,
 * then navigate — and every copy had the same gap between them: the app shell
 * stayed mounted and authenticated while the cookie was already gone, so its
 * queries 401ed and painted a load failure over the app the user was trying to
 * leave. A hard refresh looked fine because a fresh document has no stale
 * client state to disagree with.
 *
 * Ordering is the whole point and it is not symmetric:
 *
 *  1. `beginSignOut()` first, so no surface renders authenticated UI or issues
 *     an authenticated request for the rest of this document's life. Doing this
 *     after the request leaves that window open; invalidating a cache instead
 *     only schedules a re-read, which answers "authenticated" until it lands.
 *  2. Revoke the server session, and WAIT for it. Navigating first can abandon
 *     the request and leave the session live — the user would be silently
 *     signed back in on their next visit.
 *  3. Only then leave, with a full location change so the next document
 *     re-runs the server auth guard from scratch.
 */
import { agentNativePath } from "./api-path.js";
import { buildSignInReturnHref } from "./require-session.js";
import { beginSignOut, notifySessionInvalidated } from "./use-session.js";

const LOGOUT_PATH = "/_agent-native/auth/logout";
const LOGOUT_ALL_PATH = "/_agent-native/auth/logout-all";

export interface SignOutOptions {
  /**
   * Where to send the browser once the session is revoked. Defaults to the
   * framework sign-in page carrying a continuation back to the current URL.
   */
  redirectTo?: string;
  /**
   * Revoke every session for this user on every device rather than just this
   * browser's. Requires an authenticated session to start with.
   */
  allDevices?: boolean;
}

/**
 * Sign the current user out and leave for the sign-in page.
 *
 * Resolves only if the navigation did not take effect, so callers should treat
 * it as terminal and not render anything afterwards.
 */
export async function signOut(options: SignOutOptions = {}): Promise<void> {
  beginSignOut();
  const path = options.allDevices ? LOGOUT_ALL_PATH : LOGOUT_PATH;
  try {
    const response = await fetch(agentNativePath(path), {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      // Worth surfacing: the cookie may still be live server-side even though
      // this document has already given up its session.
      console.warn("Sign-out request returned an error", response.status);
    }
  } catch (error) {
    console.warn("Unable to complete the sign-out request", error);
  }
  // The first notification protects this document. This second one makes
  // other tabs revalidate after the server has finished revoking the session.
  notifySessionInvalidated();
  // `replace`, not `assign`: the dead authenticated URL must not stay in
  // history, or Back lands on a shell with no session.
  window.location.replace(options.redirectTo ?? buildSignInReturnHref());
}
