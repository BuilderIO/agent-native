import { createHash } from "node:crypto";

import { resolveCredential } from "../credentials/index.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import type {
  RemoteAgentAuth,
  RemoteAgentOAuthClientCredentialsAuth,
} from "../resources/metadata.js";
import { parseRemoteAgentUrl } from "../resources/metadata.js";
import { workspacePrivateOrigins } from "./workspace-private-origins.js";

export type RemoteAgentAuthErrorCode =
  | "credential_missing"
  | "credential_rejected"
  | "invalid_auth"
  | "token_request_failed";

export class RemoteAgentAuthError extends Error {
  readonly code: RemoteAgentAuthErrorCode;
  readonly statusCode?: number;
  readonly credentialRef?: string;
  readonly tokenUrl?: string;

  constructor(options: {
    code: RemoteAgentAuthErrorCode;
    message: string;
    statusCode?: number;
    credentialRef?: string;
    tokenUrl?: string;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "RemoteAgentAuthError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.credentialRef = options.credentialRef;
    this.tokenUrl = options.tokenUrl;
  }
}

export class RemoteAgentCredentialRejectedError extends RemoteAgentAuthError {
  readonly status: 401 | 403;

  constructor(options: {
    status: 401 | 403;
    credentialRef?: string;
    tokenUrl?: string;
  }) {
    super({
      code: "credential_rejected",
      statusCode: options.status,
      credentialRef: options.credentialRef,
      tokenUrl: options.tokenUrl,
      message: `Hosted agent credentials were rejected (HTTP ${options.status}).`,
    });
    this.name = "RemoteAgentCredentialRejectedError";
    this.status = options.status;
  }
}

export interface RemoteAgentCredentialContext {
  userEmail?: string;
  orgId?: string | null;
}

interface CachedClientCredentialsToken {
  token: string;
  expiresAt: number;
}

const clientCredentialsTokenCache = new Map<
  string,
  CachedClientCredentialsToken
>();
const TOKEN_CACHE_SKEW_MS = 30_000;
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

export function clearRemoteAgentTokenCache(): void {
  clientCredentialsTokenCache.clear();
}

/**
 * Resolve the configured auth reference for a connected hosted agent.
 *
 * The manifest carries only vault reference names. Values are resolved inside
 * the current request's user/org scope and never read from process.env.
 */
export async function resolveRemoteAgentToken(
  auth: RemoteAgentAuth | undefined,
  context: RemoteAgentCredentialContext = {},
): Promise<string | undefined> {
  if (!auth) return undefined;

  if (auth.type === "bearer") {
    return resolveVaultCredential(auth.credentialRef, context);
  }

  return resolveClientCredentialsToken(auth, context);
}

async function resolveVaultCredential(
  credentialRef: string,
  context: RemoteAgentCredentialContext,
): Promise<string> {
  const ref = credentialRef.trim();
  if (!ref) {
    throw new RemoteAgentAuthError({
      code: "invalid_auth",
      message: "Hosted agent bearer auth is missing its credential reference.",
    });
  }
  if (!context.userEmail?.trim()) {
    throw new RemoteAgentAuthError({
      code: "credential_missing",
      credentialRef: ref,
      message: "Hosted agent auth requires an authenticated workspace user.",
    });
  }

  const value = await resolveCredential(ref, {
    userEmail: context.userEmail,
    orgId: context.orgId,
  });
  if (!value?.trim()) {
    throw new RemoteAgentAuthError({
      code: "credential_missing",
      credentialRef: ref,
      message: "The configured hosted agent credential is not available.",
    });
  }
  return value.trim();
}

async function resolveClientCredentialsToken(
  auth: RemoteAgentOAuthClientCredentialsAuth,
  context: RemoteAgentCredentialContext,
): Promise<string> {
  const tokenUrl = validateTokenUrl(auth.tokenUrl);
  const clientId = auth.clientId.trim();
  const clientSecretRef = auth.clientSecretRef.trim();
  const scope = auth.scope?.trim();
  if (!clientId || !clientSecretRef) {
    throw new RemoteAgentAuthError({
      code: "invalid_auth",
      message:
        "Hosted agent OAuth auth is missing its client ID or client-secret reference.",
    });
  }
  const clientSecret = await resolveVaultCredential(clientSecretRef, context);
  // fingerprint of the resolved secret so replacing a value invalidates the
  const secretFingerprint = createHash("sha256")
    .update(clientSecret)
    .digest("hex");
  const cacheKey = [
    tokenUrl,
    clientId,
    clientSecretRef,
    secretFingerprint,
    scope ?? "",
    context.userEmail?.trim().toLowerCase() ?? "",
    context.orgId?.trim() ?? "",
  ].join("\u0000");
  const cached = clientCredentialsTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    ...(scope ? { scope } : {}),
  });

  let response: Response;
  try {
    response = await ssrfSafeFetch(
      tokenUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      },
      {
        maxRedirects: 0,
        followRedirects: false,
        allowedPrivateOrigins: workspacePrivateOrigins(),
      },
    );
  } catch (cause) {
    throw new RemoteAgentAuthError({
      code: "token_request_failed",
      tokenUrl,
      message: "The hosted agent token endpoint could not be reached.",
      cause,
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new RemoteAgentCredentialRejectedError({
      status: response.status,
      credentialRef: clientSecretRef,
      tokenUrl,
    });
  }
  if (!response.ok) {
    throw new RemoteAgentAuthError({
      code: "token_request_failed",
      statusCode: response.status,
      tokenUrl,
      message: `The hosted agent token endpoint returned HTTP ${response.status}.`,
    });
  }

  let responseBody: string;
  try {
    responseBody = await response.text();
  } catch (cause) {
    throw new RemoteAgentAuthError({
      code: "token_request_failed",
      tokenUrl,
      message: "The hosted agent token endpoint response could not be read.",
      cause,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseBody);
  } catch (cause) {
    throw new RemoteAgentAuthError({
      code: "token_request_failed",
      tokenUrl,
      message: "The hosted agent token endpoint returned invalid JSON.",
      cause,
    });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RemoteAgentAuthError({
      code: "token_request_failed",
      tokenUrl,
      message: "The hosted agent token endpoint returned an invalid response.",
    });
  }

  const accessToken = (payload as Record<string, unknown>).access_token;
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new RemoteAgentAuthError({
      code: "token_request_failed",
      tokenUrl,
      message:
        "The hosted agent token endpoint did not return an access token.",
    });
  }
  const expiresIn = parseExpiresIn(
    (payload as Record<string, unknown>).expires_in,
  );
  if (expiresIn > 0) {
    clientCredentialsTokenCache.set(cacheKey, {
      token: accessToken.trim(),
      expiresAt: Date.now() + Math.max(1_000, expiresIn - TOKEN_CACHE_SKEW_MS),
    });
  }
  return accessToken.trim();
}

function validateTokenUrl(value: string): string {
  const url = parseRemoteAgentUrl(value, { requireHttps: true });
  try {
    const parsed = new URL(url ?? "");
    if (parsed.username || parsed.password) throw new Error("credentials");
    return parsed.toString();
  } catch (cause) {
    throw new RemoteAgentAuthError({
      code: "invalid_auth",
      tokenUrl: value,
      message: "Hosted agent auth has an invalid token URL.",
      cause,
    });
  }
}

function parseExpiresIn(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed * 1_000;
}
