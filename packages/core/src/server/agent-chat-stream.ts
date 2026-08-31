import { randomUUID } from "node:crypto";

import * as jose from "jose";

import { getAppConfig } from "../app-config/index.js";
import { getAuthSecret } from "./better-auth-instance.js";

/** Exact public transport path exposed by the dedicated streaming Lambda. */
export const AGENT_CHAT_STREAM_PATH = "/_agent-native/agent-chat-stream";
export const AGENT_CHAT_STREAM_TOKEN_SUFFIX = "/stream-token";
export const AGENT_CHAT_STREAM_TOKEN_TTL_SECONDS = 15 * 60;

const AGENT_CHAT_STREAM_TOKEN_TYPE = "agent-native-agent-chat-stream";

export interface AgentChatStreamPrincipal {
  ownerEmail: string;
  orgId: string | null;
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
}): Promise<string> {
  const ownerEmail = validateOwnerEmail(input.ownerEmail);
  const issuer = streamTokenIssuer();
  return new jose.SignJWT({
    token_type: AGENT_CHAT_STREAM_TOKEN_TYPE,
    sub: ownerEmail,
    org_id: input.orgId ?? null,
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
    return {
      ownerEmail: validateOwnerEmail(payload.sub),
      orgId,
    };
    // coercion-ok: signature, issuer, audience, and expiry failures mean invalid authorization.
  } catch {
    return null;
  }
}
