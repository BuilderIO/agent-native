import { resolveSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import {
  hasSessionHint,
  isSessionNavigationPending,
  navigateForSession,
  SessionPreloadContext,
  useSession,
} from "@agent-native/core/client/use-session";
import { subscribeSessionNavigation } from "@agent-native/core/shared/ssr-session-bootstrap";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { AppShellSkeleton } from "../shared/AppShellSkeleton.js";

export interface RequireSessionProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  redirect?: boolean;
  signedOut?: React.ReactNode;
  /**
   * Skip the gate entirely and always render children. Use for surfaces that
   * authenticate by another mechanism (e.g. an embed/popout iframe carrying
   * its own token) so they are never bounced to the sign-in page.
   */
  bypass?: boolean;
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
  // Only the session endpoint's definitive "signed out" sends a visitor to
  // sign-in; loading and unavailable never navigate.
  const signInHref =
    status === "unauthenticated" && redirect ? resolveSignInReturnHref() : null;

  useEffect(() => {
    if (signInHref) navigateForSession(signInHref, "signed_out");
  }, [signInHref]);

  const navigationPending = useSyncExternalStore(
    subscribeSessionNavigation,
    isSessionNavigationPending,
    () => false,
  );
  const appShownRef = useRef(false);
  // The hint says a session is likely; the session read below still decides.
  const [sessionHinted] = useState(hasSessionHint);

  // A navigation this load started before the app rendered (sign-in here, or
  // the inline beta lane switch) keeps the shell down, so the app never
  // flashes before the page leaves. An app already on screen is never
  // unmounted for one: a lane switch cancelled by a beforeunload "Stay" would
  // take its unsaved state with it. A claim the page never leaves on is
  // released after a stall window, which brings the app back.
  const holdingForNavigation = navigationPending && !appShownRef.current;
  if (status === "loading" || holdingForNavigation) {
    // With a hint, the app mounts hidden while the session reads, so its action
    // reads start now instead of one round trip later. The server still enforces
    // auth: a refused read re-checks the session, and a signed-out answer
    // redirects through the same path as before.
    const preloadApp =
      status === "loading" && sessionHinted && !holdingForNavigation;
    if (!preloadApp) return <>{fallback ?? <AppShellSkeleton />}</>;
    return (
      <>
        {fallback ?? <AppShellSkeleton />}
        <SessionPreloadContext.Provider value={true}>
          <SessionShell hidden>{children}</SessionShell>
        </SessionPreloadContext.Provider>
      </>
    );
  }
  if (status === "unavailable") {
    return <SessionUnavailableNotice retry={retry} />;
  }
  if (!session) {
    if (redirect) return <>{fallback ?? <AppShellSkeleton />}</>;
    return <>{signedOut ?? null}</>;
  }
  appShownRef.current = true;
  // Same slots as the hidden preload above, so the tree that mounted while the
  // session loaded is the tree that shows, not a second mount.
  return (
    <>
      {null}
      <SessionPreloadContext.Provider value={false}>
        <SessionShell>{children}</SessionShell>
      </SessionPreloadContext.Provider>
    </>
  );
}

function SessionShell({
  hidden = false,
  children,
}: {
  hidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: hidden ? "none" : "contents" }}>{children}</div>
  );
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
