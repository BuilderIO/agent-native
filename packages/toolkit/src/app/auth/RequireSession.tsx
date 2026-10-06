import { resolveSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import {
  isSessionNavigationPending,
  navigateForSession,
  useSession,
} from "@agent-native/core/client/use-session";
import { subscribeSessionNavigation } from "@agent-native/core/shared/ssr-session-bootstrap";
import React, { useEffect, useRef, useSyncExternalStore } from "react";

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

  // A navigation this load started before the app rendered (sign-in here, or
  // the inline beta lane switch) keeps the shell down, so the app never
  // flashes before the page leaves. An app already on screen is never
  // unmounted for one: a lane switch cancelled by a beforeunload "Stay" would
  // take its unsaved state with it. A claim the page never leaves on is
  // released after a stall window, which brings the app back.
  if (status === "loading" || (navigationPending && !appShownRef.current)) {
    return <>{fallback ?? <AppShellSkeleton />}</>;
  }
  if (status === "unavailable") {
    return <SessionUnavailableNotice retry={retry} />;
  }
  if (!session) {
    if (redirect) return <>{fallback ?? <AppShellSkeleton />}</>;
    return <>{signedOut ?? null}</>;
  }
  appShownRef.current = true;
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
