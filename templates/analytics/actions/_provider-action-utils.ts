import { resolveCredential } from "../server/lib/credentials";
import {
  tryRequestCredentialContext,
  type CredentialContext,
} from "../server/lib/credentials-context";
import { hasAnalyticsProviderCredential } from "../server/lib/provider-credentials";

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

const WORKSPACE_PROVIDER_BY_KEY: Record<string, string> = {
  GITHUB_TOKEN: "github",
  HUBSPOT_ACCESS_TOKEN: "hubspot",
  HUBSPOT_PRIVATE_APP_TOKEN: "hubspot",
  NOTION_API_KEY: "notion",
  SLACK_BOT_TOKEN: "slack",
};

function workspaceProviderForKeys(keys: string[]): string | null {
  const providers = keys.map((key) => WORKSPACE_PROVIDER_BY_KEY[key]);
  if (providers.some((provider) => !provider)) return null;
  const unique = new Set(providers);
  return unique.size === 1 ? providers[0]! : null;
}

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

  const workspaceProvider = workspaceProviderForKeys(keys);
  if (workspaceProvider) {
    const configured = await hasAnalyticsProviderCredential({
      provider: workspaceProvider,
      keys,
      ctx,
    });
    if (configured) return { ok: true, ctx };
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
    mode === "any"
      ? firstKey
      : (keys.find((key) => !configured[key]) ?? firstKey);

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
