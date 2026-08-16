import { TEMPLATE_APPS } from "@agent-native/shared-app-config";

import { saveSessionToken } from "./session-token-store";

const dispatchApp = TEMPLATE_APPS.find((app) => app.id === "dispatch");
export const NATIVE_AUTH_BASE_URL =
  dispatchApp?.url ?? "https://dispatch.agent-native.com";

type NativeAuthResponse = {
  error?: unknown;
  email?: unknown;
  orgId?: unknown;
  token?: unknown;
};

function responseMessage(
  payload: NativeAuthResponse | null,
): string | undefined {
  return typeof payload?.error === "string" && payload.error.trim()
    ? payload.error.trim()
    : undefined;
}

export type NativeAuthMode = "sign-in" | "sign-up";

export interface NativeAuthResult {
  email: string;
  token: string;
  orgId?: string;
}

async function postPasswordAuth(
  mode: NativeAuthMode,
  email: string,
  password: string,
  baseUrl: string,
): Promise<NativeAuthResponse | null> {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/_agent-native/auth/${mode === "sign-up" ? "register" : "login"}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Request-Source": "mobile",
      },
      body: JSON.stringify({ email, password }),
    },
  );

  let payload: NativeAuthResponse | null = null;
  try {
    payload = (await response.json()) as NativeAuthResponse;
  } catch (error) {
    // The status below remains the source of truth when the server did not
    // return JSON.
    console.warn("[mobile auth] auth response was not valid JSON", {
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }

  if (!response.ok) {
    throw new Error(
      responseMessage(payload) ??
        (mode === "sign-up"
          ? "Could not create your account. Please try again."
          : "Sign in failed. Check your email and password."),
    );
  }
  return payload;
}

export async function authenticateWithPassword({
  mode,
  email,
  password,
  baseUrl = NATIVE_AUTH_BASE_URL,
}: {
  mode: NativeAuthMode;
  email: string;
  password: string;
  baseUrl?: string;
}): Promise<NativeAuthResult> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail || !password) {
    throw new Error("Enter your email and password to continue.");
  }

  if (mode === "sign-up") {
    await postPasswordAuth("sign-up", normalizedEmail, password, baseUrl);
  }

  // Registration intentionally completes with the same login response shape
  // so the parent stores exactly one session credential for both paths.
  const payload = await postPasswordAuth(
    "sign-in",
    normalizedEmail,
    password,
    baseUrl,
  );

  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  const returnedEmail =
    typeof payload?.email === "string" && payload.email.trim()
      ? payload.email.trim()
      : email.trim();
  if (!token || !returnedEmail) {
    throw new Error(
      mode === "sign-up"
        ? "Account created, but sign-in could not finish. Check your email and try again."
        : "Sign in did not return a mobile session. Please try again.",
    );
  }

  await saveSessionToken(token);
  const orgId =
    typeof payload?.orgId === "string" && payload.orgId.trim()
      ? payload.orgId.trim()
      : undefined;
  return { email: returnedEmail, token, ...(orgId ? { orgId } : {}) };
}

export async function signInWithPassword(options: {
  email: string;
  password: string;
  baseUrl?: string;
}): Promise<NativeAuthResult> {
  return authenticateWithPassword({ ...options, mode: "sign-in" });
}
