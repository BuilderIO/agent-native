import { randomUUID } from "node:crypto";

import * as jose from "jose";

import { getAppConfig } from "../app-config/index.js";
import { getAuthSecret } from "./better-auth-instance.js";

export const AGENT_CHAT_STREAM_PATH = "/_agent-native/agent-chat-stream";
export const AGENT_CHAT_STREAM_TOKEN_SUFFIX = "/stream-token";
export const AGENT_CHAT_STREAM_TOKEN_TTL_SECONDS = 15 * 60;

const AGENT_CHAT_STREAM_TOKEN_TYPE = "agent-native-agent-chat-stream";

export interface AgentChatStreamPrincipal {
  ownerEmail: string;
  orgId: string | null;
  authUserId?: string;
}

function streamTokenIssuer(): string {
  const issuer = getAppConfig().app.url?.trim();
  if (!issuer) {
    throw new Error(
      "Agent-chat stream tokens require APP_URL to identify the foreground app.",
    );
  }
  return issuer;
}

function streamTokenKey(): Uint8Array {
  const secret = getAuthSecret().trim();
  if (!secret) {
    throw new Error(
      "Agent-chat stream tokens require BETTER_AUTH_SECRET or the configured auth secret.",
    );
  }
  return new TextEncoder().encode(secret);
}

function validateOwnerEmail(ownerEmail: string): string {
  const normalized = ownerEmail.trim();
  if (
    !normalized ||
    normalized.length > 320 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("Agent-chat stream tokens require a valid session owner.");
  }
  return normalized;
}

export function isAgentChatStreamingRuntime(): boolean {
  return getAppConfig().runtime.agentChatStreaming;
}

export function readAgentChatStreamBearerToken(
  authorization: string | undefined,
): string | null {
  if (typeof authorization !== "string") return null;
  const match = authorization.trim().match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token && token.length <= 4096 ? token : null;
}

export async function createAgentChatStreamToken(input: {
  ownerEmail: string;
  orgId?: string | null;
  authUserId?: string;
}): Promise<string> {
  const ownerEmail = validateOwnerEmail(input.ownerEmail);
  const authUserId = input.authUserId?.trim();
  if (
    input.authUserId !== undefined &&
    (!authUserId ||
      authUserId.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(authUserId))
  ) {
    throw new Error("Agent-chat stream auth user id is invalid.");
  }
  const issuer = streamTokenIssuer();
  return new jose.SignJWT({
    token_type: AGENT_CHAT_STREAM_TOKEN_TYPE,
    sub: ownerEmail,
    org_id: input.orgId ?? null,
    ...(authUserId ? { auth_user_id: authUserId } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(issuer)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${AGENT_CHAT_STREAM_TOKEN_TTL_SECONDS}s`)
    .sign(streamTokenKey());
}

export async function verifyAgentChatStreamToken(
  token: string,
): Promise<AgentChatStreamPrincipal | null> {
  try {
    const issuer = streamTokenIssuer();
    const { payload } = await jose.jwtVerify(token, streamTokenKey(), {
      algorithms: ["HS256"],
      issuer,
      audience: issuer,
    });
    if (
      payload.token_type !== AGENT_CHAT_STREAM_TOKEN_TYPE ||
      typeof payload.sub !== "string" ||
      !payload.sub.trim() ||
      !Object.prototype.hasOwnProperty.call(payload, "org_id")
    ) {
      return null;
    }
    const orgId = payload.org_id;
    if (orgId !== null && typeof orgId !== "string") return null;
    const authUserId = payload.auth_user_id;
    if (
      authUserId !== undefined &&
      (typeof authUserId !== "string" ||
        !authUserId.trim() ||
        authUserId.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(authUserId))
    ) {
      return null;
    }
    return {
      ownerEmail: validateOwnerEmail(payload.sub),
      orgId,
      ...(authUserId ? { authUserId } : {}),
    };
    // coercion-ok: signature, issuer, audience, and expiry failures mean invalid authorization.
  } catch {
    return null;
  }
}
