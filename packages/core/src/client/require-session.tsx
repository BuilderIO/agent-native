import React, { useEffect, useRef } from "react";

import {
  SIGN_IN_ENTRY_PATH,
  signInJourney,
} from "../shared/sign-in-journey.js";
import { appBasePath, appPath } from "./api-path.js";
import { AppShellSkeleton } from "./AppShellSkeleton.js";
import { useSession } from "./use-session.js";

function currentJourney(returnTo?: string) {
  const { pathname, search, hash } = window.location;
  return signInJourney({
    at: returnTo ?? pathname + search + hash,
    continuation: new URLSearchParams(search).get("c"),
    legacyReturn: new URLSearchParams(search).get("return"),
    basePath: appBasePath(),
    homePath: window.__AGENT_NATIVE_CONFIG__?.appHomePath,
  });
}

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
  const redirectedRef = useRef(false);

  const mustRedirect = status === "unauthenticated" && redirect;

  useEffect(() => {
    if (!mustRedirect) return;
    if (redirectedRef.current) return;
    if (typeof window === "undefined") return;
    const { signInHref } = currentJourney();
    if (!signInHref) return;
    redirectedRef.current = true;
    window.location.replace(signInHref);
  }, [mustRedirect]);

  if (status === "loading") return <>{fallback ?? <AppShellSkeleton />}</>;
  if (status === "unavailable") {
    return <SessionUnavailableNotice retry={retry} />;
  }
  if (!session) {
    if (redirect) return <>{fallback ?? <AppShellSkeleton />}</>;
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
