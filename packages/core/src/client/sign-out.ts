import {
  BETA_REDIRECT_SIGN_OUT_STORAGE_KEY,
  BETA_REDIRECT_STORAGE_KEY,
} from "../shared/environment-lanes.js";
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
 *  2. Clear registered transient client state while the session cookie still
 *     works, then revoke the server session and WAIT for it. Navigating first
 *     can abandon the request and leave the session live — the user would be
 *     silently signed back in on their next visit.
 *  3. On success, leave with a full location change so the next document
 *     re-runs the server auth guard from scratch. On failure, reload the
 *     current document so it can re-read the still-authoritative session.
 */
import { clearActionQueryCache } from "./action-query-cache.js";
import { agentNativePath } from "./api-path.js";
import { clearRecorder } from "./recorder.js";
import { buildSignInReturnHref } from "./sign-in-return.js";
import {
  beginSignOut,
  completeSignOut,
  runBeforeSignOutCleanups,
} from "./use-session.js";

const LOGOUT_PATH = "/_agent-native/auth/logout";
const SIGN_OUT_REQUEST_TIMEOUT_MS = 15_000;

export const SIGN_OUT_SEARCH_TERMS = [
  "log out",
  "log-out",
  "logout",
  "sign out",
  "sign-out",
  "signout",
] as const;

let signOutOperation: Promise<void> | null = null;

function setBetaRedirectSignOutSignal(): void {
  const signOutWindow = window as Window & {
    __agentNativeBetaRedirectSignOutStarted?: boolean;
  };
  signOutWindow.__agentNativeBetaRedirectSignOutStarted = true;
  try {
    window.sessionStorage.setItem(BETA_REDIRECT_SIGN_OUT_STORAGE_KEY, "1");
  } catch {
    // coercion-ok: the in-memory signal still protects this document when storage is unavailable.
  }
}

function clearBetaRedirectSignOutSignal(): void {
  const signOutWindow = window as Window & {
    __agentNativeBetaRedirectSignOutStarted?: boolean;
  };
  signOutWindow.__agentNativeBetaRedirectSignOutStarted = false;
  try {
    window.sessionStorage.removeItem(BETA_REDIRECT_SIGN_OUT_STORAGE_KEY);
  } catch {
    // coercion-ok: sign-out navigation must not depend on optional storage.
  }
}

function clearBetaRedirectMarker(): void {
  try {
    window.localStorage.removeItem(BETA_REDIRECT_STORAGE_KEY);
  } catch {
    // coercion-ok: local storage is optional; sign-out must still complete.
  }
}

export interface SignOutOptions {
  redirectTo?: string;
}

export type SignOutCleanup = () => void | Promise<void>;

export class SignOutCleanupError extends Error {
  readonly code = "sign_out_cleanup_failed";
  readonly retryable = true;

  constructor() {
    super("Local app data could not be cleared. Retry sign-out.");
    this.name = "SignOutCleanupError";
  }
}

const signOutCleanups = new Set<SignOutCleanup>();

export function registerSignOutCleanup(cleanup: SignOutCleanup): () => void {
  signOutCleanups.add(cleanup);
  return () => signOutCleanups.delete(cleanup);
}

function runSignOutCleanups(
  cleanups: SignOutCleanup[],
): Promise<void> | undefined {
  if (cleanups.length === 0) return undefined;
  return Promise.allSettled(
    cleanups.map((cleanup) => Promise.resolve().then(cleanup)),
  ).then((results) => {
    if (results.some((result) => result.status === "rejected")) {
      throw new SignOutCleanupError();
    }
  });
}

export function signOut(options: SignOutOptions = {}): Promise<void> {
  if (signOutOperation) return signOutOperation;
  const operation = signOutFlow(options);
  signOutOperation = operation;
  void operation.catch((error) => {
    if (
      error instanceof SignOutCleanupError &&
      signOutOperation === operation
    ) {
      signOutOperation = null;
    }
  });
  return operation;
}

async function signOutFlow(options: SignOutOptions): Promise<void> {
  const registeredCleanups = [...signOutCleanups];
  const registeredCleanup = runSignOutCleanups(registeredCleanups);
  if (registeredCleanup) await registeredCleanup;
  setBetaRedirectSignOutSignal();
  beginSignOut();
  const cleanup = runBeforeSignOutCleanups();
  if (cleanup) {
    for (const error of await cleanup) {
      console.warn("Unable to clear client presence before sign-out", error);
    }
  }
  clearRecorder();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SIGN_OUT_REQUEST_TIMEOUT_MS,
  );
  let revoked = false;
  try {
    const response = await fetch(agentNativePath(LOGOUT_PATH), {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn("Sign-out request returned an error", response.status);
    } else {
      revoked = true;
    }
  } catch (error) {
    console.warn("Unable to complete the sign-out request", error);
  } finally {
    clearTimeout(timeout);
  }
  // Stored results outlive this document. A failed clear is logged and sign-out
  // continues: each record is keyed by user and org, so the next session cannot read it.
  await clearActionQueryCache().catch((error) =>
    console.warn("Unable to clear cached action results", error),
  );
  if (!revoked) {
    clearBetaRedirectSignOutSignal();
    clearBetaRedirectMarker();
    window.location.reload();
    return;
  }
  completeSignOut();
  clearBetaRedirectSignOutSignal();
  clearBetaRedirectMarker();
  window.location.replace(options.redirectTo ?? buildSignInReturnHref());
}
