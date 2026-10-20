import { agentNativePath } from "../api-path.js";

type TwoFactorResponse = Record<string, unknown>;

export interface TwoFactorStatus {
  enabled: boolean;
}

export type TwoFactorSetup = TwoFactorResponse & {
  method: "totp";
  totpURI: string;
  backupCodes: string[];
};

const isTwoFactorSetup = (data: TwoFactorResponse): data is TwoFactorSetup =>
  data.method === "totp" &&
  typeof data.totpURI === "string" &&
  Array.isArray(data.backupCodes) &&
  data.backupCodes.every((code): code is string => typeof code === "string");

const isTwoFactorStatus = (data: unknown): data is TwoFactorStatus =>
  data !== null &&
  typeof data === "object" &&
  !Array.isArray(data) &&
  typeof (data as TwoFactorResponse).enabled === "boolean";

const isSuccessfulTwoFactorResponse = (
  data: TwoFactorResponse,
): data is TwoFactorResponse & { ok: true } => data.ok === true;

const isDisabledTwoFactorResponse = (
  data: TwoFactorResponse,
): data is TwoFactorResponse & { status: true } => data.status === true;

async function requestTwoFactor<T extends TwoFactorResponse>(
  path: string,
  body: Record<string, unknown> = {},
  isValid: (data: TwoFactorResponse) => data is T,
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
  if (!data || !isValid(data)) {
    throw new Error("Two-factor authentication returned an invalid response.");
  }
  return data;
}

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  const response = await fetch(
    agentNativePath("/_agent-native/auth/two-factor/status"),
    { credentials: "include" },
  );
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("Could not load two-factor settings.");
  }
  if (!response.ok) throw new Error("Could not load two-factor settings.");
  if (!isTwoFactorStatus(data)) {
    throw new Error("Could not load two-factor settings.");
  }
  return data;
}

export function enableTwoFactor(password?: string): Promise<TwoFactorSetup> {
  return requestTwoFactor<TwoFactorSetup>(
    "/_agent-native/auth/two-factor/enable",
    password ? { password } : {},
    isTwoFactorSetup,
  );
}

export function verifyTwoFactor(code: string): Promise<{ ok: true }> {
  return requestTwoFactor<{ ok: true }>(
    "/_agent-native/auth/two-factor/verify",
    { code },
    isSuccessfulTwoFactorResponse,
  );
}

export function disableTwoFactor(password?: string): Promise<{ status: true }> {
  return requestTwoFactor<{ status: true }>(
    "/_agent-native/auth/two-factor/disable",
    password ? { password } : {},
    isDisabledTwoFactorResponse,
  );
}
