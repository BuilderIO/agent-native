import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { signA2AToken } from "./client.js";

const DEFAULT_A2A_CALLER_TOKEN_TTL = "30m";

export interface A2ACallerAuth {
  apiKey?: string;
  apiKeyFallbacks?: string[];
  userEmail?: string;
  orgId?: string;
  orgDomain?: string;
  orgSecret?: string;
  metadata: Record<string, unknown>;
}

export async function resolveA2ACallerAuth(options?: {
  expiresIn?: string | number;
  includeGoogleToken?: boolean;
}): Promise<A2ACallerAuth> {
  const userEmail = getRequestUserEmail();
  const metadata: Record<string, unknown> = {};
  if (userEmail) metadata.userEmail = userEmail;

  let orgDomain: string | undefined;
  let orgSecret: string | undefined;
  const orgId = getRequestOrgId();
  if (orgId) {
    try {
      const { getOrgDomain } = await import("../org/context.js");
      orgDomain = (await getOrgDomain(orgId)) ?? undefined;
      if (orgDomain) metadata.orgDomain = orgDomain;
    } catch {}
    try {
      const { getOrgA2ASecret } = await import("../org/context.js");
      orgSecret = (await getOrgA2ASecret(orgId)) ?? undefined;
    } catch {}
  }

  const apiKeyAttempts: string[] = [];
  const addApiKeyAttempt = (token: string | undefined) => {
    if (!token || apiKeyAttempts.includes(token)) return;
    apiKeyAttempts.push(token);
  };
  if (userEmail && (orgSecret || process.env.A2A_SECRET)) {
    if (process.env.A2A_SECRET?.trim()) {
      try {
        addApiKeyAttempt(
          await signA2AToken(userEmail, orgDomain, orgSecret, {
            expiresIn: options?.expiresIn ?? DEFAULT_A2A_CALLER_TOKEN_TTL,
            preferGlobalSecret: true,
          }),
        );
      } catch {}
    }
    if (orgSecret) {
      try {
        addApiKeyAttempt(
          await signA2AToken(userEmail, orgDomain, orgSecret, {
            expiresIn: options?.expiresIn ?? DEFAULT_A2A_CALLER_TOKEN_TTL,
            preferGlobalSecret: false,
          }),
        );
      } catch {}
    }
  }

  if (options?.includeGoogleToken) {
    await attachGoogleTokenMetadata(metadata, userEmail);
  }

  return {
    apiKey: apiKeyAttempts[0],
    ...(apiKeyAttempts.length > 1
      ? { apiKeyFallbacks: apiKeyAttempts.slice(1) }
      : {}),
    userEmail,
    orgId,
    orgDomain,
    orgSecret,
    metadata,
  };
}

async function attachGoogleTokenMetadata(
  metadata: Record<string, unknown>,
  userEmail: string | undefined,
): Promise<void> {
  if (process.env.NODE_ENV !== "production" || !userEmail) return;

  try {
    const { listOAuthAccountsByOwner } =
      await import("../oauth-tokens/store.js");
    const accounts = await listOAuthAccountsByOwner("google", userEmail);
    const tokens = accounts[0]?.tokens;
    if (tokens?.access_token) {
      metadata.googleToken = tokens.access_token;
    }
  } catch {}
}
