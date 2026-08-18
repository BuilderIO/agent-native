import { resolveNativeAuthCopy } from "@agent-native/core/shared/auth-copy";
import type {
  DesktopIdentityAuthRequest,
  DesktopIdentityAuthResult,
  DesktopIdentityMagicLinkRequest,
  DesktopIdentityMagicLinkResult,
} from "@shared/ipc-channels";
import { useEffect, useRef, useState } from "react";

const GOOGLE_COLORS = {
  blue: "#4285F4", // guard:allow-raw-color - Google's official brand mark colors.
  green: "#34A853", // guard:allow-raw-color - Google's official brand mark colors.
  yellow: "#FBBC05", // guard:allow-raw-color - Google's official brand mark colors.
  red: "#EA4335", // guard:allow-raw-color - Google's official brand mark colors.
} as const;

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill={GOOGLE_COLORS.blue}
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill={GOOGLE_COLORS.green}
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill={GOOGLE_COLORS.yellow}
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill={GOOGLE_COLORS.red}
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

const COPY = resolveNativeAuthCopy(
  typeof navigator === "undefined" ? undefined : navigator.language,
);
const TERMS_URL = "https://www.agent-native.com/terms";
const PRIVACY_URL = "https://www.agent-native.com/privacy";

interface DesktopIdentityGateProps {
  appName: string;
  status: DesktopIdentityStatus | "checking";
  /** Opens Google in the system browser and completes the desktop exchange. */
  onSignIn: () => boolean | Promise<boolean>;
  /** Performs the trusted inline password sign-in in the main process. */
  onAuthenticate: (
    request: DesktopIdentityAuthRequest,
  ) => Promise<DesktopIdentityAuthResult>;
  /** Requests a magic link; verification is completed in the system browser. */
  onMagicLink: (
    request: DesktopIdentityMagicLinkRequest,
  ) => Promise<DesktopIdentityMagicLinkResult>;
}

/**
 * The parent identity surface is native to the Electron shell. Child app
 * WebViews stay covered until the broker has copied their app-scoped sessions.
 */
export default function DesktopIdentityGate({
  appName,
  status,
  onSignIn,
  onAuthenticate,
  onMagicLink,
}: DesktopIdentityGateProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"magic-link" | "password">(
    "magic-link",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSentEmail, setMagicLinkSentEmail] = useState<string | null>(
    null,
  );
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (status === "sign-in-required" || status === "failed") {
      emailRef.current?.focus();
    }
    if (status === "failed") {
      setMagicLinkSentEmail(null);
      setSubmitting(false);
      setError((current) => current ?? COPY.failedToConnect);
    }
    if (status === "signed-in" || status === "idle") {
      setMagicLinkSentEmail(null);
      setSubmitting(false);
    }
  }, [status]);

  if (status === "idle" || status === "signed-in") return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const normalizedEmail = email.trim();
    if (!normalizedEmail || (authMode === "password" && !password)) return;

    setSubmitting(true);
    setError(null);
    try {
      if (authMode === "magic-link") {
        const result = await onMagicLink({ email: normalizedEmail });
        if (!result.ok) {
          setError(result.error ?? COPY.magicLinkFailed);
        } else if (result.pending) {
          setMagicLinkSentEmail(result.email ?? normalizedEmail);
        }
        return;
      }

      const result = await onAuthenticate({
        mode: "sign-in",
        email: normalizedEmail,
        password,
      });
      if (!result.ok) {
        setError(result.error ?? COPY.invalidLogin);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : COPY.failedToConnect,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const startGoogleSignIn = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (!(await onSignIn())) {
        setError(COPY.googleNeverFinished);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : COPY.failedToConnect,
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "checking") {
    return (
      <div
        className="desktop-identity-gate"
        role="dialog"
        aria-modal="true"
        aria-label={`${appName} sign-in`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="desktop-identity-gate__panel">
          <div className="desktop-identity-gate__spinner" aria-hidden="true" />
          <span className="desktop-identity-gate__status">{COPY.checking}</span>
        </div>
      </div>
    );
  }

  if (magicLinkSentEmail && status !== "failed") {
    return (
      <div
        className="desktop-identity-gate"
        role="dialog"
        aria-modal="true"
        aria-label={COPY.magicLinkSent}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="desktop-identity-gate__panel desktop-identity-gate__panel--form">
          <div className="desktop-identity-gate__success-title">
            {COPY.magicLinkSent}
          </div>
          <p className="desktop-identity-gate__success-copy">
            {COPY.magicLinkSentCopy} <strong>{magicLinkSentEmail}</strong>.
          </p>
          <button
            type="button"
            className="desktop-identity-gate__mode-link"
            onClick={() => setMagicLinkSentEmail(null)}
          >
            {COPY.back}
          </button>
        </div>
      </div>
    );
  }

  const busy = submitting || status === "signing-in";
  const canSubmit = Boolean(
    email.trim() && (authMode === "magic-link" || password),
  );

  return (
    <div
      className="desktop-identity-gate"
      role="dialog"
      aria-modal="true"
      aria-label={`${appName} sign-in`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="desktop-identity-gate__panel desktop-identity-gate__panel--form">
        <div className="desktop-identity-gate__heading">
          <h1>{COPY.welcomeTitle}</h1>
          <p>{COPY.welcomeSubtitle}</p>
        </div>
        <form className="desktop-identity-gate__form" onSubmit={submit}>
          <button
            type="button"
            className="desktop-identity-gate__provider"
            onClick={() => void startGoogleSignIn()}
            disabled={busy}
          >
            <GoogleIcon />
            <span>{COPY.googleButton}</span>
          </button>

          <div className="desktop-identity-gate__divider" aria-hidden="true">
            <span>{COPY.dividerOr}</span>
          </div>

          <label htmlFor="desktop-identity-email">{COPY.email}</label>
          <input
            id="desktop-identity-email"
            ref={emailRef}
            type="email"
            autoComplete="email"
            placeholder={COPY.emailPlaceholder}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
            aria-label={COPY.email}
            required
            disabled={busy}
          />

          {authMode === "password" ? (
            <input
              type="password"
              autoComplete="current-password"
              placeholder={COPY.enterPasswordPlaceholder}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
              aria-label={COPY.password}
              required
              disabled={busy}
            />
          ) : null}

          {error ? (
            <p className="desktop-identity-gate__error" role="alert">
              {error}
            </p>
          ) : null}

          {busy || canSubmit ? (
            <button
              type="submit"
              className="desktop-identity-gate__submit desktop-identity-gate__submit--primary"
              disabled={!canSubmit || busy}
            >
              {busy
                ? authMode === "magic-link"
                  ? COPY.sending
                  : COPY.signingIn
                : authMode === "magic-link"
                  ? COPY.sendMagicLink
                  : COPY.signIn}
            </button>
          ) : null}

          {authMode === "magic-link" ? (
            <p className="desktop-identity-gate__legal">
              {COPY.legalPrefix}{" "}
              <a
                href={TERMS_URL}
                onClick={(event) => {
                  event.preventDefault();
                  void window.electronAPI?.shell.openExternal(TERMS_URL);
                }}
              >
                {COPY.legalTerms}
              </a>{" "}
              {COPY.legalConnector}{" "}
              <a
                href={PRIVACY_URL}
                onClick={(event) => {
                  event.preventDefault();
                  void window.electronAPI?.shell.openExternal(PRIVACY_URL);
                }}
              >
                {COPY.legalPrivacy}
              </a>
              {COPY.legalSuffix}
            </p>
          ) : null}

          <button
            type="button"
            className="desktop-identity-gate__mode-link"
            onClick={() => {
              setError(null);
              setPassword("");
              setAuthMode((current) =>
                current === "magic-link" ? "password" : "magic-link",
              );
            }}
            disabled={busy}
          >
            {authMode === "magic-link"
              ? COPY.usePasswordInstead
              : COPY.backToMagicLink}
          </button>
        </form>
      </div>
    </div>
  );
}
