import { trackEvent } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import { resolveNativeAuthCopy } from "@agent-native/core/shared/auth-copy";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import { AccountGateHeader } from "./account-gate-header";

export interface CreateAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Same-origin viewer path to restore after the account is created. */
  returnTo: string;
  /** The action that brought an anonymous viewer into the account flow. */
  intent?: AccountGateIntent;
  /** Fired when the viewer chooses the returning-user path. */
  onSignIn?: () => void;
  /** Refresh the viewer after the auth flow establishes a session. */
  onAuthenticated: () => void;
}

export type AccountGateIntent = "comment" | "react" | "agent" | "continue";

export type AccountGateDialogProps = CreateAccountDialogProps;

type AuthMode = "magic-link" | "password";

function responseError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as { error?: unknown; message?: unknown };
  const candidate = record.error ?? record.message;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      className="size-[18px] shrink-0"
      viewBox="0 0 24 24"
    >
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      {/* guard:allow-raw-color - Google's official brand mark colors. */}
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function createOAuthFlowId(): string {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Fall through to a browser-safe identifier.
  }
  return `clips-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createOAuthVerifier(): string {
  try {
    if (typeof crypto.randomUUID === "function") {
      return `${crypto.randomUUID()}${crypto.randomUUID()}`;
    }
  } catch {
    // Fall through to a browser-safe verifier.
  }
  return `${createOAuthFlowId()}${createOAuthFlowId()}`.replace(
    /[^A-Za-z0-9_-]/g,
    "",
  );
}

/**
 * Public-share account gating composes the framework's shared auth pattern:
 * magic-link first, the standard Google entry point, and email/password as a
 * fallback. Clips owns only the intent copy and continuation callback.
 */
export function AccountGateDialog({
  open,
  onOpenChange,
  returnTo,
  intent = "continue",
  onSignIn,
  onAuthenticated,
}: AccountGateDialogProps) {
  const t = useT();
  const copy = resolveNativeAuthCopy(
    typeof navigator === "undefined" ? undefined : navigator.language,
  );
  const [authMode, setAuthMode] = useState<AuthMode>("magic-link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [magicLinkSentEmail, setMagicLinkSentEmail] = useState<string | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const oauthRunRef = useRef(0);
  const signInHref = buildSignInReturnHref({ returnTo });

  useEffect(() => {
    if (open) return;
    oauthRunRef.current += 1;
    setAuthMode("magic-link");
    setEmail("");
    setPassword("");
    setPasswordConfirmation("");
    setMagicLinkSentEmail(null);
    setErrorMessage(null);
    setSubmitting(false);
    setGoogleBusy(false);
  }, [open]);

  const startGoogleSignup = async () => {
    if (googleBusy || submitting) return;
    const popup = window.open("", "_blank", "width=640,height=760");
    if (!popup) {
      setErrorMessage(copy.failedToConnect);
      return;
    }
    try {
      popup.opener = null;
    } catch {
      // Some browsers expose popup.opener as read-only.
    }

    const runId = oauthRunRef.current + 1;
    oauthRunRef.current = runId;
    setGoogleBusy(true);
    setErrorMessage(null);
    trackEvent("auth.signup_clicked", {
      surface: "public_share_modal",
      method: "google",
      intent,
    });

    try {
      const flowId = createOAuthFlowId();
      const verifier = createOAuthVerifier();
      const authUrl = new URL(
        appPath("/_agent-native/google/auth-url"),
        window.location.origin,
      );
      authUrl.searchParams.set("return", returnTo);
      authUrl.searchParams.set("desktop", "1");
      authUrl.searchParams.set("flow_id", flowId);
      const authResponse = await fetch(authUrl.toString(), {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Agent-Native-Desktop-Verifier": verifier,
        },
      });
      const authData = await authResponse.json().catch(() => null);
      const googleUrl =
        authData && typeof authData.url === "string" ? authData.url : null;
      if (!authResponse.ok || !googleUrl) {
        throw new Error("google-auth-url-failed");
      }
      popup.location.href = googleUrl;

      const deadline = Date.now() + 5 * 60 * 1000;
      let closedAt: number | null = null;
      while (Date.now() < deadline && oauthRunRef.current === runId) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        if (oauthRunRef.current !== runId) return;
        try {
          if (popup.closed && closedAt === null) closedAt = Date.now();
        } catch {
          closedAt ??= Date.now();
        }
        const exchangeResponse = await fetch(
          `${appPath("/_agent-native/auth/desktop-exchange")}?flow_id=${encodeURIComponent(flowId)}`,
          {
            credentials: "include",
            headers: {
              Accept: "application/json",
              "X-Agent-Native-Desktop-Verifier": verifier,
            },
          },
        );
        const exchangeData = await exchangeResponse.json().catch(() => null);
        if (
          exchangeResponse.ok &&
          exchangeData &&
          (typeof exchangeData.email === "string" ||
            typeof exchangeData.token === "string")
        ) {
          popup.close();
          setGoogleBusy(false);
          trackEvent("auth.signup_completed", {
            surface: "public_share_modal",
            method: "google",
            intent,
          });
          onAuthenticated();
          return;
        }
        if (closedAt !== null && Date.now() - closedAt > 7000) break;
      }
      if (oauthRunRef.current === runId) {
        popup.close();
        setErrorMessage(copy.googleNeverFinished);
        setGoogleBusy(false);
      }
    } catch {
      popup.close();
      if (oauthRunRef.current === runId) {
        setErrorMessage(copy.failedToConnect);
        setGoogleBusy(false);
      }
    }
  };

  const submitMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || googleBusy) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage(copy.invalidEmail);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    trackEvent("auth.signup_clicked", {
      surface: "public_share_modal",
      method: "magic_link",
      intent,
    });
    try {
      const response = await fetch(appPath("/_agent-native/auth/magic-link"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, callbackURL: returnTo }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorMessage(responseError(data) ?? copy.magicLinkFailed);
        return;
      }
      setMagicLinkSentEmail(normalizedEmail);
    } catch {
      setErrorMessage(copy.failedToConnect);
    } finally {
      setSubmitting(false);
    }
  };

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || googleBusy) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) return;
    if (password !== passwordConfirmation) {
      setErrorMessage(t("signInPrompt.passwordsMismatch"));
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    trackEvent("auth.signup_clicked", {
      surface: "public_share_modal",
      method: "password",
      intent,
    });
    try {
      const registerResponse = await fetch(
        appPath("/_agent-native/auth/register"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: normalizedEmail,
            password,
            callbackURL: returnTo,
          }),
        },
      );
      const registerData = await registerResponse.json().catch(() => null);
      if (!registerResponse.ok) {
        setErrorMessage(responseError(registerData) ?? copy.failedToConnect);
        return;
      }

      const loginResponse = await fetch(appPath("/_agent-native/auth/login"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      if (loginResponse.ok) {
        trackEvent("auth.signup_completed", {
          surface: "public_share_modal",
          method: "password",
          intent,
        });
        onAuthenticated();
        return;
      }
      if (loginResponse.status === 403) {
        window.location.assign(buildCreateAccountHref(returnTo));
        return;
      }
      const loginData = await loginResponse.json().catch(() => null);
      setErrorMessage(responseError(loginData) ?? copy.failedToConnect);
    } catch {
      setErrorMessage(copy.failedToConnect);
    } finally {
      setSubmitting(false);
    }
  };

  const title =
    intent === "agent"
      ? t("signInPrompt.agentTitle")
      : intent === "continue"
        ? t("signInPrompt.genericTitle")
        : t("signInPrompt.title", {
            intent: t(
              intent === "comment"
                ? "signInPrompt.commentIntent"
                : "signInPrompt.reactIntent",
            ),
          });
  const busy = submitting || googleBusy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-h-[min(90vh,44rem)] gap-0 overflow-y-auto p-0 sm:max-w-md"
        data-auth-pattern="native"
        data-account-gate-intent={intent}
      >
        <div className="px-6 pb-7 pt-8 sm:px-8 sm:pb-8">
          <AccountGateHeader
            actionLabel={title}
            returnLabel={t("signInPrompt.description")}
            welcomeLabel={copy.welcomeTitle}
          />

          {magicLinkSentEmail ? (
            <div className="mt-8 grid gap-4" aria-live="polite">
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <p className="font-medium">{copy.magicLinkSent}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy.magicLinkSentCopy} {magicLinkSentEmail}.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="w-fit px-0"
                onClick={() => setMagicLinkSentEmail(null)}
              >
                {copy.back}
              </Button>
            </div>
          ) : (
            <form
              className="mt-7 grid gap-4"
              onSubmit={
                authMode === "magic-link" ? submitMagicLink : submitPassword
              }
            >
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 w-full justify-center gap-3 border border-input bg-background text-[15px] font-medium text-foreground hover:bg-accent"
                disabled={busy}
                onClick={() => void startGoogleSignup()}
              >
                <GoogleMark />
                {googleBusy ? copy.signingIn : copy.googleButton}
              </Button>

              <div className="flex items-center gap-3 py-1" aria-hidden="true">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">
                  {copy.dividerOr}
                </span>
                <Separator className="flex-1" />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="create-account-email">{copy.email}</Label>
                <Input
                  id="create-account-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder={copy.emailPlaceholder}
                  required
                  value={email}
                  disabled={busy}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setErrorMessage(null);
                  }}
                />
              </div>

              {authMode === "password" ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="create-account-password">
                      {copy.password}
                    </Label>
                    <Input
                      id="create-account-password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      required
                      value={password}
                      disabled={busy}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setErrorMessage(null);
                      }}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="create-account-password-confirmation">
                      {copy.confirmPassword}
                    </Label>
                    <Input
                      id="create-account-password-confirmation"
                      name="passwordConfirmation"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      required
                      value={passwordConfirmation}
                      disabled={busy}
                      onChange={(event) => {
                        setPasswordConfirmation(event.target.value);
                        setErrorMessage(null);
                      }}
                    />
                  </div>
                </>
              ) : null}

              {errorMessage ? (
                <p className="text-sm text-destructive" role="alert">
                  {errorMessage}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={busy}>
                {submitting
                  ? authMode === "magic-link"
                    ? copy.sending
                    : copy.signingIn
                  : authMode === "magic-link"
                    ? copy.sendMagicLink
                    : t("signInPrompt.createAccount")}
              </Button>

              <p className="text-xs leading-5 text-muted-foreground">
                {copy.legalPrefix}{" "}
                <a
                  href="https://www.agent-native.com/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:no-underline"
                >
                  {copy.legalTerms}
                </a>{" "}
                {copy.legalConnector}{" "}
                <a
                  href="https://www.agent-native.com/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:no-underline"
                >
                  {copy.legalPrivacy}
                </a>
                {copy.legalSuffix}
              </p>

              <div className="flex flex-col-reverse items-start gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="ghost" asChild className="px-0">
                  <a href={signInHref} onClick={() => onSignIn?.()}>
                    {copy.signIn}
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0 text-xs font-medium"
                  onClick={() => {
                    setErrorMessage(null);
                    setAuthMode((mode) =>
                      mode === "magic-link" ? "password" : "magic-link",
                    );
                  }}
                >
                  {authMode === "magic-link"
                    ? copy.usePasswordInstead
                    : copy.backToMagicLink}
                </Button>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** @deprecated Prefer AccountGateDialog so every gated action shares one flow. */
export const CreateAccountDialog = AccountGateDialog;

export function buildCreateAccountHref(returnTo: string): string {
  const href = buildSignInReturnHref({ returnTo });
  return `${href}${href.includes("?") ? "&" : "?"}tab=signup&initialPrompt=1&embedded=1`;
}
