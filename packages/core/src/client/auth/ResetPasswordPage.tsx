/** @jsxRuntime classic */

import * as React from "react";

export interface ResetPasswordPageProps {
  pageType: "reset-password";
  appBasePath: string;
  passwordMinLength: number;
  passwordMaxLength: number;
}

type ResetMessage = { kind: "error" | "success"; text: string } | null;

function inferResetBasePath(pathname: string): string {
  const marker = "/_agent-native/auth/reset";
  const markerIndex = pathname.indexOf(marker);
  return markerIndex >= 0 ? pathname.slice(0, markerIndex) : "";
}

function resetErrorText(
  data: Record<string, unknown>,
  fallback: string,
  passwordMinLength: number,
  passwordMaxLength: number,
): string {
  const candidate = data.error ?? data.message;
  if (typeof candidate !== "string" || !candidate.trim()) return fallback;
  const message = candidate.trim();
  if (
    /failed query|\bselect\b.*\bfrom\b|\binsert\b.*\binto\b|\bupdate\b.*\bset\b|\bdelete\b.*\bfrom\b|\bsql\b|database|relation .* does not exist|column .* does not exist|syntax error|constraint|connection refused|econn|timeout/i.test(
      message,
    )
  ) {
    return fallback;
  }
  if (/password.*(?:at least|minimum|min(?:imum)?|too short)/i.test(message)) {
    return `Choose a password with at least ${passwordMinLength} characters.`;
  }
  if (/password.*(?:at most|maximum|max(?:imum)?|too long)/i.test(message)) {
    return `Choose a password with no more than ${passwordMaxLength} characters.`;
  }
  return message;
}

export function ResetPasswordPage({
  appBasePath,
  passwordMinLength,
  passwordMaxLength,
}: ResetPasswordPageProps) {
  const [runtimeAppBasePath, setRuntimeAppBasePath] =
    React.useState(appBasePath);
  const [token, setToken] = React.useState("");
  const [tokenChecked, setTokenChecked] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [message, setMessage] = React.useState<ResetMessage>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!appBasePath) {
      setRuntimeAppBasePath(inferResetBasePath(window.location.pathname));
    }
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
    setTokenChecked(true);
  }, [appBasePath]);

  const passwordInvalid = React.useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      if (input.validity.tooShort) {
        input.setCustomValidity(
          `Choose a password with at least ${passwordMinLength} characters.`,
        );
      } else if (input.validity.tooLong) {
        input.setCustomValidity(
          `Choose a password with no more than ${passwordMaxLength} characters.`,
        );
      }
    },
    [passwordMaxLength, passwordMinLength],
  );
  const clearPasswordValidity = React.useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      event.currentTarget.setCustomValidity("");
    },
    [],
  );

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (password !== confirmation) {
        setMessage({ kind: "error", text: "Passwords do not match." });
        return;
      }
      setSaving(true);
      setMessage(null);
      try {
        const response = await fetch(
          `${runtimeAppBasePath}/_agent-native/auth/ba/reset-password`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newPassword: password, token }),
          },
        );
        if (response.ok) {
          setMessage({
            kind: "success",
            text: "Password updated — redirecting to sign in…",
          });
          window.setTimeout(() => {
            window.location.href = `${runtimeAppBasePath}/`;
          }, 1200);
          return;
        }
        let data: Record<string, unknown> = {};
        try {
          const parsed: unknown = await response.json();
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            data = parsed as Record<string, unknown>;
          }
        } catch {
          // coercion-ok: error status and fallback copy remain distinguishable.
        }
        setMessage({
          kind: "error",
          text: resetErrorText(
            data,
            "We couldn't update your password. The link may have expired; request a new one.",
            passwordMinLength,
            passwordMaxLength,
          ),
        });
        setSaving(false);
      } catch {
        setMessage({
          kind: "error",
          text: "We couldn't reach the server. Check your connection and try again.",
        });
        setSaving(false);
      }
    },
    [
      confirmation,
      password,
      passwordMaxLength,
      passwordMinLength,
      runtimeAppBasePath,
      token,
    ],
  );

  const missingToken = tokenChecked && !token;
  return (
    <div className="card reset-password-card">
      <h1>Choose a new password</h1>
      <p className="subtitle">Set a new password for your account.</p>
      <form id="reset-form" onSubmit={handleSubmit} hidden={missingToken}>
        <label htmlFor="p1">New password</label>
        <input
          id="p1"
          type="password"
          autoComplete="new-password"
          placeholder={`At least ${passwordMinLength} characters`}
          required
          minLength={passwordMinLength}
          maxLength={passwordMaxLength}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          onInvalid={passwordInvalid}
          onInput={clearPasswordValidity}
        />
        <label htmlFor="p2">Confirm password</label>
        <input
          id="p2"
          type="password"
          autoComplete="new-password"
          placeholder="Confirm password"
          required
          minLength={passwordMinLength}
          maxLength={passwordMaxLength}
          value={confirmation}
          onChange={(event) => setConfirmation(event.currentTarget.value)}
          onInvalid={passwordInvalid}
          onInput={clearPasswordValidity}
        />
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save new password"}
        </button>
        {message ? (
          <p className={`msg show ${message.kind}`} role="status">
            {message.text}
          </p>
        ) : null}
      </form>
      {missingToken ? (
        <p className="msg show error" role="alert">
          This password reset link is missing or invalid. Request a new one.
        </p>
      ) : null}
      <a className="back" id="back-link" href={`${runtimeAppBasePath}/`}>
        Back to sign in
      </a>
    </div>
  );
}
