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
import { useSession } from "./use-session.js";
import { DefaultSpinner } from "./DefaultSpinner.js";
import { agentNativePath } from "./api-path.js";

export interface RequireSessionProps {
  children: React.ReactNode;
  /**
   * Rendered while the session is being resolved and while a redirect is in
   * flight. Defaults to the framework `<DefaultSpinner />`.
   */
  fallback?: React.ReactNode;
  /**
   * When true (default), unauthenticated visitors are redirected to the
   * framework sign-in entry point (`/_agent-native/sign-in`) with a `return`
   * query pointing back at the current URL — so they land back here once
   * signed in. When false, `signedOut` is rendered instead and no navigation
   * happens.
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

/** Build the framework sign-in URL that returns to the current location. */
export function buildSignInReturnHref(): string {
  const base = agentNativePath("/_agent-native/sign-in");
  if (typeof window === "undefined") return base;
  const ret =
    window.location.pathname + window.location.search + window.location.hash;
  return `${base}?return=${encodeURIComponent(ret)}`;
}

export function RequireSession({
  children,
  fallback,
  redirect = true,
  signedOut,
  bypass = false,
}: RequireSessionProps) {
  const { session, isLoading } = useSession();
  // Guard against firing the redirect more than once (effect re-runs, React
  // StrictMode double-invoke) — a second navigation while the first is in
  // flight is harmless but noisy.
  const redirectedRef = useRef(false);

  const mustRedirect = !bypass && !isLoading && !session && redirect;

  useEffect(() => {
    if (!mustRedirect) return;
    if (redirectedRef.current) return;
    if (typeof window === "undefined") return;
    redirectedRef.current = true;
    // `replace` (not `assign`) so the dead authenticated URL doesn't land in
    // history — pressing Back after signing in shouldn't bounce here again.
    window.location.replace(buildSignInReturnHref());
  }, [mustRedirect]);

  if (bypass) return <>{children}</>;
  // Still resolving, or redirect already in flight: show the loading fallback
  // rather than flashing app chrome the visitor can't use.
  if (isLoading) return <>{fallback ?? <DefaultSpinner />}</>;
  if (!session) {
    if (redirect) return <>{fallback ?? <DefaultSpinner />}</>;
    return <>{signedOut ?? null}</>;
  }
  return <>{children}</>;
}
