import { resolveCredential } from "../server/lib/credentials";
import {
  tryRequestCredentialContext,
  type CredentialContext,
} from "../server/lib/credentials-context";

export interface MissingCredentialResult {
  error: "missing_api_key";
  key: string;
  label: string;
  message: string;
  settingsPath: string;
}

export interface CredentialCheckOk {
  ok: true;
  ctx: CredentialContext;
}

export interface CredentialCheckMissing {
  ok: false;
  response: MissingCredentialResult;
}

export type CredentialCheckResult = CredentialCheckOk | CredentialCheckMissing;

export async function requireActionCredentials(
  keys: string[],
  label: string,
  options: {
    mode?: "all" | "any";
    message?: string;
    settingsPath?: string;
  } = {},
): Promise<CredentialCheckResult> {
  const ctx = tryRequestCredentialContext();
  const firstKey = keys[0] ?? label;
  const settingsPath = options.settingsPath ?? "/data-sources";

  if (!ctx) {
    return {
      ok: false,
      response: {
        error: "missing_api_key",
        key: firstKey,
        label,
        message: "Sign in to access this data source.",
        settingsPath,
      },
    };
  }

  const configured: Record<string, boolean> = {};
  await Promise.all(
    keys.map(async (key) => {
      configured[key] = !!(await resolveCredential(key, ctx));
    }),
  );

  const mode = options.mode ?? "all";
  const hasRequired =
    mode === "any"
      ? keys.some((key) => configured[key])
      : keys.every((key) => configured[key]);

  if (hasRequired) return { ok: true, ctx };

  const missingKey =
    mode === "any" ? firstKey : keys.find((key) => !configured[key]) ?? firstKey;

  return {
    ok: false,
    response: {
      error: "missing_api_key",
      key: missingKey,
      label,
      message:
        options.message ??
        `Connect your ${label} account in Settings -> Data sources, then retry.`,
      settingsPath,
    },
  };
}

export function providerError(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) };
}
