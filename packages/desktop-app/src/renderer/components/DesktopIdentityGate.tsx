import { IconLock, IconLoader2, IconRefresh } from "@tabler/icons-react";

interface DesktopIdentityGateProps {
  appName: string;
  status: DesktopIdentityStatus | "checking";
  onSignIn: () => void;
}

/**
 * Keep the first-run decision in the Desktop surface while the actual
 * credential ceremony stays in the isolated main-process identity window.
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
              ? "Finish signing in"
              : isRetry
                ? "Sign-in needs another try"
                : "Create your Agent Native account"}
        </h2>
        <p>
          {isChecking
            ? "Checking your session before opening this app."
            : isSigningIn
              ? "Complete magic link, Google, or email sign-in in the Agent Native window."
              : isRetry
                ? "The workspace sign-in did not finish. Try again to open this app."
                : `Use magic link, Google, or email sign-in to open ${appName} and your other eligible apps without repeating login.`}
        </p>
        {!isChecking && !isSigningIn && (
          <button type="button" onClick={onSignIn}>
            {isRetry ? "Try again" : "Sign in or create account"}
          </button>
        )}
      </div>
    </div>
  );
}
