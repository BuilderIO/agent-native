import { useCallback, useEffect, useState, type ReactNode } from "react";

export interface DesktopOnboardingHostProps {
  /** The signed-in account's onboarding key, or null while it loads or failed. */
  scope: string | null;
  /** Hides this onboarding until the person opens another app or account. */
  onClose(scope?: string): void;
}

/**
 * Onboarding a build of the desktop app shows over one chat-first app's pane,
 * for a signed-in person. Registered through `onboardingHosts` on `App`.
 */
export interface DesktopOnboardingHost {
  appId: string;
  render(props: DesktopOnboardingHostProps): ReactNode;
  /** Told whether this host's onboarding is the one showing now. */
  onActiveChange?(active: boolean): void;
}

// A deferral made before the scope loaded belongs to this placeholder, so an
// account whose scope then loads never inherits it.
const UNKNOWN_SCOPE = "unknown";

export function OnboardingHostSlot({
  hosts,
  activeAppId,
  signedIn,
  identityEpoch,
}: {
  hosts: readonly DesktopOnboardingHost[];
  activeAppId: string;
  signedIn: boolean;
  /** Changes whenever the shell identity does, so the scope is read again. */
  identityEpoch: number;
}) {
  const [scope, setScope] = useState<string | null>(null);
  const [deferredScope, setDeferredScope] = useState<string | null>(null);
  const deferred =
    deferredScope !== null && deferredScope === (scope ?? UNKNOWN_SCOPE);
  const defer = useCallback(
    (closedScope?: string) =>
      setDeferredScope(closedScope ?? scope ?? UNKNOWN_SCOPE),
    [scope],
  );

  useEffect(() => {
    setDeferredScope(null);
  }, [activeAppId]);

  useEffect(() => {
    setScope(null);
    if (!signedIn || hosts.length === 0) return;
    let current = true;
    window.electronAPI.identity
      .getOnboardingScope()
      .then((next) => {
        if (typeof next !== "string")
          throw new Error("Invalid onboarding scope");
        if (current) setScope(next);
      })
      .catch((error: unknown) =>
        console.error("[onboarding] account scope unavailable", error),
      );
    return () => {
      current = false;
    };
  }, [signedIn, identityEpoch, hosts.length]);

  useEffect(() => {
    for (const host of hosts)
      host.onActiveChange?.(
        signedIn && !deferred && host.appId === activeAppId,
      );
  }, [hosts, signedIn, deferred, activeAppId]);

  if (!signedIn || deferred) return null;
  const host = hosts.find((candidate) => candidate.appId === activeAppId);
  return host ? <>{host.render({ scope, onClose: defer })}</> : null;
}
