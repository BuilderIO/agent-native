import { IconLock, IconLoader2, IconRefresh } from "@tabler/icons-react";

interface DesktopIdentityGateProps {
  appName: string;
  status: DesktopIdentityStatus | "checking";
  /** Opens the hosted canonical Google and magic-link flow. */
  onSignIn: () => void;
}

/**
 * Keep the canonical hosted login in the Desktop parent identity window. Child
 * app WebViews are never asked to render a second credential surface while the
 * workspace identity is being established.
 */
export default function DesktopIdentityGate({
  appName,
  status,
  onSignIn,
}: DesktopIdentityGateProps) {
  if (status === "idle" || status === "signed-in") return null;

  const isChecking = status === "checking";
  const isSigningIn = status === "signing-in";
  const isRetry = status === "failed";

  return (
    <div
      className="desktop-identity-gate"
      role="dialog"
      aria-modal="true"
      aria-label={`${appName} sign-in`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="desktop-identity-gate__panel">
        <div className="desktop-identity-gate__icon" aria-hidden="true">
          {isChecking || isSigningIn ? (
            <IconLoader2 size={20} className="desktop-identity-gate__spinner" />
          ) : isRetry ? (
            <IconRefresh size={20} />
          ) : (
            <IconLock size={20} />
          )}
        </div>
        <h2>
          {isChecking
            ? "Checking your Agent Native account"
            : isSigningIn
              ? "Opening your workspace"
              : "Sign in once to open your workspace"}
        </h2>
        <p>
          {isChecking
            ? "Checking your session before opening this app."
            : isSigningIn
              ? "Signing you in once, then opening your eligible workspace apps."
              : isRetry
                ? "The workspace sign-in did not finish. Try again to open this app."
                : `Continue to the hosted sign-in to open ${appName} and your other eligible apps without repeating login.`}
        </p>

        {!isChecking && !isSigningIn ? (
          <button
            type="button"
            className="desktop-identity-gate__provider"
            onClick={onSignIn}
          >
            Continue to sign in
          </button>
        ) : null}
      </div>
    </div>
  );
}
