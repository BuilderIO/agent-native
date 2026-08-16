import { IconLock, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { FormEvent, useEffect, useState } from "react";

interface DesktopIdentityGateProps {
  appName: string;
  status: DesktopIdentityStatus | "checking";
  /** Opens the hosted canonical Google and magic-link flow. */
  onSignIn: () => void;
}

type AuthMode = "sign-in" | "sign-up";

/**
 * Keep account creation in the Desktop parent surface. Child app WebViews are
 * never asked to render their own login page while the workspace identity is
 * being established.
 */
export default function DesktopIdentityGate({
  appName,
  status,
  onSignIn,
}: DesktopIdentityGateProps) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "sign-in-required") {
      setSubmitting(false);
      setError(null);
    }
  }, [status]);

  if (status === "idle" || status === "signed-in") return null;

  const isChecking = status === "checking";
  const isSigningIn = status === "signing-in" || submitting;
  const isRetry = status === "failed";
  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    (mode === "sign-in" || password === confirmPassword) &&
    !isSigningIn;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    if (mode === "sign-up" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const authenticate = window.electronAPI?.identity?.authenticate;
    if (!authenticate) {
      onSignIn();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await authenticate({
        mode,
        email: email.trim(),
        password,
      });
      if (!result.ok) {
        setError(result.error ?? "Sign-in could not be completed.");
        setSubmitting(false);
        return;
      }
      setPassword("");
      setConfirmPassword("");
    } catch {
      setError("Could not reach the identity service. Please try again.");
      setSubmitting(false);
    }
  }

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
              : mode === "sign-up"
                ? "Create your workspace account"
                : "Sign in once to open your workspace"}
        </h2>
        <p>
          {isChecking
            ? "Checking your session before opening this app."
            : isSigningIn
              ? "Signing you in once, then opening your eligible workspace apps."
              : isRetry
                ? "The workspace sign-in did not finish. Try again to open this app."
                : `Sign in here to open ${appName} and your other eligible apps without repeating login.`}
        </p>

        {!isChecking && !isSigningIn ? (
          <>
            <button
              type="button"
              className="desktop-identity-gate__provider"
              onClick={onSignIn}
            >
              Continue with Google or magic link
            </button>
            <div className="desktop-identity-gate__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "sign-in"}
                className={mode === "sign-in" ? "is-active" : undefined}
                onClick={() => {
                  setMode("sign-in");
                  setError(null);
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "sign-up"}
                className={mode === "sign-up" ? "is-active" : undefined}
                onClick={() => {
                  setMode("sign-up");
                  setError(null);
                }}
              >
                Create account
              </button>
            </div>
            <form
              className="desktop-identity-gate__form"
              onSubmit={(event) => void submit(event)}
            >
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError(null);
                  }}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError(null);
                  }}
                  autoComplete={
                    mode === "sign-up" ? "new-password" : "current-password"
                  }
                  required
                />
              </label>
              {mode === "sign-up" ? (
                <label>
                  Confirm password
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      setError(null);
                    }}
                    autoComplete="new-password"
                    required
                  />
                </label>
              ) : null}
              {error ? (
                <p className="desktop-identity-gate__error" role="alert">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={!canSubmit}
                className="desktop-identity-gate__submit"
              >
                {mode === "sign-up" ? "Create account" : "Sign in"}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
