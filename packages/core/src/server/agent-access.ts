import {
  DEFAULT_AGENT_ACCESS_TTL_SECONDS,
  scopedAgentAccessResourceId,
  type AgentAccessResourceScope,
} from "../shared/agent-access.js";
import {
  signShortLivedToken,
  verifyShortLivedToken,
  type VerifyResult,
} from "./short-lived-token.js";

export {
  AGENT_ACCESS_PARAM,
  DEFAULT_AGENT_ACCESS_TTL_SECONDS,
  appendAgentAccessParam,
  buildAgentAccessApiUrl,
  buildAgentAccessUrl,
  normalizeAgentAccessBasePath,
  normalizeAgentAccessOrigin,
  scopedAgentAccessResourceId,
  toAgentAccessUrl,
  type AgentAccessApiUrlOptions,
  type AgentAccessResourceScope,
  type AgentAccessUrlOptions,
} from "../shared/agent-access.js";

export interface ScopedAgentAccessTokenOptions extends AgentAccessResourceScope {
  viewerEmail?: string;
  ttlSeconds?: number;
}

export interface ScopedAgentAccessGrant {
  token: string;
  expiresAt: string;
  ttlSeconds: number;
}

export function signScopedAgentAccessToken({
  resourceKind,
  resourceId,
  viewerEmail,
  ttlSeconds = DEFAULT_AGENT_ACCESS_TTL_SECONDS,
}: ScopedAgentAccessTokenOptions): string {
  return signShortLivedToken({
    resourceId: scopedAgentAccessResourceId(resourceKind, resourceId),
    viewerEmail,
    ttlSeconds,
  });
}

export function verifyScopedAgentAccessToken(
  token: string,
  scope: AgentAccessResourceScope,
): VerifyResult {
  if (!token) return { ok: false, reason: "missing" };
  return verifyShortLivedToken(
    token,
    scopedAgentAccessResourceId(scope.resourceKind, scope.resourceId),
  );
}

export function createScopedAgentAccessGrant(
  options: ScopedAgentAccessTokenOptions,
): ScopedAgentAccessGrant {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_AGENT_ACCESS_TTL_SECONDS;
  const token = signScopedAgentAccessToken({ ...options, ttlSeconds });
  return {
    token,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    ttlSeconds,
  };
}
