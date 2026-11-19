import { useCallback, useEffect, useState, type ReactNode } from "react";

/** The signed-in account's onboarding key, as far as the shell could read it. */
export type DesktopOnboardingScope =
  | { status: "loading" }
  | { status: "ready"; key: string }
  | { status: "unavailable"; error: unknown; retry(): void };

export interface DesktopOnboardingHostProps {
  /** Save onboarding state only under a `ready` key. */
  scope: DesktopOnboardingScope;
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
const LOADING: DesktopOnboardingScope = { status: "loading" };

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
  // Each read is stored with the identity epoch that made it, so the render
  // right after an account change never hands a host the previous account's key.
  const [read, setRead] = useState<{
    epoch: number;
    scope: DesktopOnboardingScope;
  } | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [deferredScope, setDeferredScope] = useState<string | null>(null);
  const scope =
    read !== null && read.epoch === identityEpoch ? read.scope : LOADING;
  const readyKey = scope.status === "ready" ? scope.key : null;
  // An identity change re-reads the scope; the deferral holds while it loads
  // and for the same account's key, but a failed read shows the host's retry.
  const deferred =
    deferredScope !== null &&
    (scope.status === "loading" || readyKey === deferredScope);
  const defer = useCallback(
    (closedScope?: string) =>
      setDeferredScope(closedScope ?? readyKey ?? UNKNOWN_SCOPE),
    [readyKey],
  );

  useEffect(() => {
    setDeferredScope(null);
  }, [activeAppId]);

  useEffect(() => {
    setRead(null);
    if (!signedIn || hosts.length === 0) return;
    let current = true;
    window.electronAPI.identity
      .getOnboardingScope()
      .then((next) => {
        if (typeof next !== "string" || next === "")
          throw new Error("Invalid onboarding scope");
        if (current)
          setRead({
            epoch: identityEpoch,
            scope: { status: "ready", key: next },
          });
      })
      .catch((error: unknown) => {
        if (!current) return;
        console.error("[onboarding] account scope unavailable", error);
        setRead({
          epoch: identityEpoch,
          scope: {
            status: "unavailable",
            error,
            retry: () => setReadAttempt((attempt) => attempt + 1),
          },
        });
      });
    return () => {
      current = false;
    };
  }, [signedIn, identityEpoch, hosts.length, readAttempt]);

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
