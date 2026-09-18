import { agentNativePath } from "../api-path.js";

export interface TwoFactorStatus {
  enabled: boolean;
}

export interface TwoFactorSetup {
  method: "totp";
  totpURI: string;
  backupCodes: string[];
}

async function requestTwoFactor<T>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(agentNativePath(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : "Two-factor authentication could not be completed.";
    throw new Error(message);
  }
  return data as T;
}

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  const response = await fetch(
    agentNativePath("/_agent-native/auth/two-factor/status"),
    { credentials: "include" },
  );
  const data = (await response.json()) as Partial<TwoFactorStatus>;
  if (!response.ok) throw new Error("Could not load two-factor settings.");
  return { enabled: data.enabled === true };
}

export function enableTwoFactor(password?: string): Promise<TwoFactorSetup> {
  return requestTwoFactor<TwoFactorSetup>(
    "/_agent-native/auth/two-factor/enable",
    password ? { password } : {},
  );
}

export function verifyTwoFactor(code: string): Promise<{ ok: true }> {
  return requestTwoFactor<{ ok: true }>(
    "/_agent-native/auth/two-factor/verify",
    { code },
  );
}

export function disableTwoFactor(password?: string): Promise<{ status: true }> {
  return requestTwoFactor<{ status: true }>(
    "/_agent-native/auth/two-factor/disable",
    password ? { password } : {},
  );
}
