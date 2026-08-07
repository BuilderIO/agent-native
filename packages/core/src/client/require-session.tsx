/**
 * Client-side session gate for an authenticated app shell.
 *
 * Wrap a template's private app shell with <RequireSession> so a logged-out
 * visitor is sent to the framework sign-in page instead of being left staring
 * at an infinite loading spinner.
 *
 * Why this exists in addition to the server-side auth guard (`runAuthGuard`,
 * which serves the onboarding/sign-in HTML for unauthenticated requests):
 * the server guard only protects requests that actually reach the Nitro
 * function. A statically-served / CDN-cached SPA shell, or a client-side
 * (React Router) navigation made after the session expired, never re-hits the
 * guard — so the app boots with no session, every data query 401s, and the UI
 * sticks on its loading state forever. This component closes that gap by
 * resolving the session on the client and redirecting when there is none.
 *
 * Place it INSIDE your providers (so the fallback is themed) but AROUND the
 * routed app layout:
 *
 *   <AppProviders ...>
 *     <RequireSession>
 *       <AppLayout><Outlet /></AppLayout>
 *     </RequireSession>
 *   </AppProviders>
 *
 * Templates with public/anonymous routes (share pages, embeds) must NOT wrap
 * their whole app — gate only the private subtree, or pass `bypass` for the
 * surfaces that authenticate by another mechanism.
 */
import React, { useEffect, useRef } from "react";

import {
  SIGN_IN_ENTRY_PATH,
  signInJourney,
} from "../shared/sign-in-journey.js";
import { appBasePath, appPath } from "./api-path.js";
import { DefaultSpinner } from "./DefaultSpinner.js";
import { useSession } from "./use-session.js";

/**
 * The sign-in journey for the browser's current location.
 *
 * `basePath` comes from `appBasePath()` and NEVER from the continuation —
 * base-path containment is the only control that stops an unsigned path-only
 * continuation from redirecting to a sibling app on a shared workspace host.
 */
function currentJourney(returnTo?: string) {
  const { pathname, search, hash } = window.location;
  return signInJourney({
    at: returnTo ?? pathname + search + hash,
    continuation: new URLSearchParams(search).get("c"),
    legacyReturn: new URLSearchParams(search).get("return"),
    basePath: appBasePath(),
  });
}

export interface RequireSessionProps {
  children: React.ReactNode;
  /**
   * Rendered while the session is being resolved and while a redirect is in
   * flight. Defaults to the framework `<DefaultSpinner />`.
   */
  fallback?: React.ReactNode;
  /**
   * When true (default), unauthenticated visitors are redirected to the
   * framework sign-in entry point (`/sign-in`) carrying a `c`
   * continuation for the current URL — so they land back here once signed in.
   * When false, `signedOut` is rendered instead and no navigation happens.
   */
  redirect?: boolean;
  /**
   * Rendered for unauthenticated visitors when `redirect` is false. Ignored
   * when `redirect` is true.
   */
  signedOut?: React.ReactNode;
  /**
   * Skip the gate entirely and always render children. Use for surfaces that
   * authenticate by another mechanism (e.g. an embed/popout iframe carrying
   * its own token) so they are never bounced to the sign-in page.
   */
  bypass?: boolean;
}

/**
 * Build the framework sign-in URL that returns the visitor to where they are
 * now (or to `returnTo`). Emits the opaque `?c=` continuation.
 *
 * Returns the bare sign-in path — no continuation — when the browser is
 * already at an auth entry path, because there is no such thing as signing in
 * from the sign-in page. Callers that navigate must use `signInJourney`
 * directly and honour its `signInHref: null`.
 */
export function buildSignInReturnHref(opts?: { returnTo?: string }): string {
  const base = appPath(SIGN_IN_ENTRY_PATH);
  if (typeof window === "undefined") return base;
  return currentJourney(opts?.returnTo).signInHref ?? base;
}

export function RequireSession({
  children,
  fallback,
  redirect = true,
  signedOut,
  bypass = false,
}: RequireSessionProps) {
  if (bypass) return <>{children}</>;
  return (
    <ResolvedSessionGate
      fallback={fallback}
      redirect={redirect}
      signedOut={signedOut}
    >
      {children}
    </ResolvedSessionGate>
  );
}

function ResolvedSessionGate({
  children,
  fallback,
  redirect = true,
  signedOut,
}: Omit<RequireSessionProps, "bypass">) {
  const { session, status, retry } = useSession();
  // Guard against firing the redirect more than once (effect re-runs, React
  // StrictMode double-invoke) — a second navigation while the first is in
  // flight is harmless but noisy.
  const redirectedRef = useRef(false);

  const mustRedirect = status === "unauthenticated" && redirect;

  useEffect(() => {
    if (!mustRedirect) return;
    if (redirectedRef.current) return;
    if (typeof window === "undefined") return;
    // `null` means the browser is already at an auth entry path — the sign-in
    // page is the framework's job, not the gate's. This is the only thing
    // standing between here and a same-URL replace loop, so it must stay a
    // null check and never gain a fallback.
    const { signInHref } = currentJourney();
    if (!signInHref) return;
    redirectedRef.current = true;
    // `replace` (not `assign`) so the dead authenticated URL doesn't land in
    // history — pressing Back after signing in shouldn't bounce here again.
    window.location.replace(signInHref);
  }, [mustRedirect]);

  // Still resolving, or redirect already in flight: show the loading fallback
  // rather than flashing app chrome the visitor can't use.
  if (status === "loading") return <>{fallback ?? <DefaultSpinner />}</>;
  // Unreadable is not signed-out. Redirecting here would bounce a signed-in
  // user to the sign-in page over a transient 5xx, and rendering the spinner
  // would strand them on a screen that never resolves.
  if (status === "unavailable") {
    return <SessionUnavailableNotice retry={retry} />;
  }
  if (!session) {
    if (redirect) return <>{fallback ?? <DefaultSpinner />}</>;
    return <>{signedOut ?? null}</>;
  }
  return <>{children}</>;
}

function SessionUnavailableNotice({ retry }: { retry: () => void }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="max-w-md text-sm text-muted-foreground">
        We couldn&apos;t reach the server to confirm your session. This is
        usually temporary.
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        Retry connection checks your session here. Reload page starts the app
        over.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={retry}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Retry connection
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}
