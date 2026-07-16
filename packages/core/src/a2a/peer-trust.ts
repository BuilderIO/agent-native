import * as jose from "jose";

import type { A2ATrustedPeer } from "./types.js";

export const A2A_INVOKE_SCOPE = "a2a:invoke";
export const A2A_APPROVE_ACTIONS_SCOPE = "a2a:approve-actions";

export interface VerifiedA2APeerIdentity {
  email: string;
  orgDomain: string | null;
  peerId: string;
  scopes: string[];
}

export interface A2APeerTrustSummary {
  peers: { active: number; revoked: number };
  credentials: {
    active: number;
    revoked: number;
    notYetActive: number;
    expired: number;
  };
  peersInRotationOverlap: number;
}

function claimStrings(value: unknown): string[] | null {
  if (typeof value === "string") {
    const values = value.split(/\s+/).filter(Boolean);
    return values.length > 0 ? values : null;
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim())
  ) {
    return [...new Set(value as string[])];
  }
  return null;
}

function validAt(
  credential: A2ATrustedPeer["credentials"][number],
  now: number,
): boolean {
  if (credential.status === "revoked") return false;
  const notBefore = credential.notBefore
    ? Date.parse(credential.notBefore)
    : Number.NEGATIVE_INFINITY;
  const expiresAt = credential.expiresAt
    ? Date.parse(credential.expiresAt)
    : Number.POSITIVE_INFINITY;
  return Number.isFinite(notBefore) || notBefore === Number.NEGATIVE_INFINITY
    ? (Number.isFinite(expiresAt) || expiresAt === Number.POSITIVE_INFINITY) &&
        now >= notBefore &&
        now < expiresAt
    : false;
}

/** Content-free deployment posture totals safe for an operator inventory. */
export function summarizeA2ATrustedPeers(
  peers: A2ATrustedPeer[],
  now = Date.now(),
): A2APeerTrustSummary {
  const summary: A2APeerTrustSummary = {
    peers: { active: 0, revoked: 0 },
    credentials: { active: 0, revoked: 0, notYetActive: 0, expired: 0 },
    peersInRotationOverlap: 0,
  };
  for (const peer of peers) {
    if (peer.revoked) summary.peers.revoked += 1;
    else summary.peers.active += 1;
    let activeCredentials = 0;
    for (const credential of peer.credentials) {
      if (credential.status === "revoked") {
        summary.credentials.revoked += 1;
        continue;
      }
      const notBefore = credential.notBefore
        ? Date.parse(credential.notBefore)
        : Number.NEGATIVE_INFINITY;
      const expiresAt = credential.expiresAt
        ? Date.parse(credential.expiresAt)
        : Number.POSITIVE_INFINITY;
      if (Number.isFinite(notBefore) && now < notBefore) {
        summary.credentials.notYetActive += 1;
      } else if (Number.isFinite(expiresAt) && now >= expiresAt) {
        summary.credentials.expired += 1;
      } else if (validAt(credential, now)) {
        summary.credentials.active += 1;
        activeCredentials += 1;
      } else {
        // Invalid timestamps are unusable and counted with expired posture.
        summary.credentials.expired += 1;
      }
    }
    if (!peer.revoked && activeCredentials > 1) {
      summary.peersInRotationOverlap += 1;
    }
  }
  return summary;
}

/**
 * Parse a deployment-owned peer registry. Invalid entries fail closed by
 * producing an empty registry; secret values remain in their named env vars.
 */
export function trustedA2APeersFromEnv(): A2ATrustedPeer[] {
  const raw = process.env.A2A_TRUSTED_PEERS?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isTrustedPeerShape)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function hasUsableA2APeerTrust(
  peers: A2ATrustedPeer[],
  now = Date.now(),
): boolean {
  return peers.some(
    (peer) =>
      !peer.revoked &&
      peer.credentials.some(
        (credential) =>
          validAt(credential, now) &&
          !!process.env[credential.secretEnv]?.trim(),
      ),
  );
}

function isTrustedPeerShape(value: unknown): value is A2ATrustedPeer {
  if (!value || typeof value !== "object") return false;
  const peer = value as Record<string, unknown>;
  return (
    typeof peer.id === "string" &&
    !!peer.id.trim() &&
    typeof peer.issuer === "string" &&
    !!peer.issuer.trim() &&
    Array.isArray(peer.audiences) &&
    peer.audiences.every((item) => typeof item === "string" && !!item.trim()) &&
    Array.isArray(peer.subjects) &&
    peer.subjects.every((item) => typeof item === "string" && !!item.trim()) &&
    (peer.orgDomains === undefined ||
      (Array.isArray(peer.orgDomains) &&
        peer.orgDomains.every(
          (item) => typeof item === "string" && !!item.trim(),
        ))) &&
    Array.isArray(peer.scopes) &&
    peer.scopes.every((item) => typeof item === "string" && !!item.trim()) &&
    Array.isArray(peer.credentials) &&
    peer.credentials.every((item) => {
      if (!item || typeof item !== "object") return false;
      const credential = item as Record<string, unknown>;
      return (
        typeof credential.id === "string" &&
        !!credential.id.trim() &&
        typeof credential.secretEnv === "string" &&
        !!credential.secretEnv.trim() &&
        (credential.status === undefined ||
          credential.status === "active" ||
          credential.status === "revoked")
      );
    })
  );
}

export async function verifyTrustedA2APeerToken(
  token: string,
  expectedAudience: string | undefined,
  peers: A2ATrustedPeer[],
  now = Date.now(),
): Promise<VerifiedA2APeerIdentity | null> {
  if (!expectedAudience) return null;
  try {
    const payloadHint = jose.decodeJwt(token);
    const header = jose.decodeProtectedHeader(token);
    const peerId =
      typeof payloadHint.peer_id === "string" ? payloadHint.peer_id : "";
    const peerMatches = peers.filter((candidate) => candidate.id === peerId);
    const peer = peerMatches[0];
    if (
      peerMatches.length !== 1 ||
      !peer ||
      peer.revoked ||
      !peer.audiences.includes(expectedAudience)
    ) {
      return null;
    }
    if (typeof header.kid !== "string" || !header.kid) return null;
    const credentialMatches = peer.credentials.filter(
      (candidate) => candidate.id === header.kid,
    );
    const credential = credentialMatches[0];
    if (
      credentialMatches.length !== 1 ||
      !credential ||
      !validAt(credential, now)
    ) {
      return null;
    }
    const secret = process.env[credential.secretEnv]?.trim();
    if (!secret) return null;

    const { payload } = await jose.jwtVerify(
      token,
      new TextEncoder().encode(secret),
      {
        algorithms: ["HS256"],
        issuer: peer.issuer,
        audience: expectedAudience,
      },
    );
    const subject = typeof payload.sub === "string" ? payload.sub : "";
    if (!subject || !peer.subjects.includes(subject)) return null;
    const orgDomain =
      typeof payload.org_domain === "string" ? payload.org_domain : null;
    if (orgDomain && !peer.orgDomains?.includes(orgDomain)) return null;
    const scopes = claimStrings(payload.scope);
    if (
      !scopes ||
      !scopes.includes(A2A_INVOKE_SCOPE) ||
      scopes.some((scope) => !peer.scopes.includes(scope))
    ) {
      return null;
    }
    return {
      email: subject,
      orgDomain,
      peerId: peer.id,
      scopes,
    };
  } catch {
    return null;
  }
}

export async function signA2APeerToken(options: {
  peerId: string;
  credentialId: string;
  secretEnv: string;
  issuer: string;
  audience: string;
  subject: string;
  scopes: string[];
  orgDomain?: string;
  expiresIn?: string | number;
}): Promise<string> {
  const secret = process.env[options.secretEnv]?.trim();
  if (!secret) {
    throw new Error(`A2A peer credential is unavailable: ${options.secretEnv}`);
  }
  if (!options.audience || !options.issuer || !options.subject) {
    throw new Error("A2A peer tokens require issuer, audience, and subject");
  }
  const scopes = [...new Set(options.scopes.filter(Boolean))];
  if (!scopes.includes(A2A_INVOKE_SCOPE)) {
    throw new Error(`A2A peer tokens require the ${A2A_INVOKE_SCOPE} scope`);
  }
  return new jose.SignJWT({
    peer_id: options.peerId,
    scope: scopes.join(" "),
    ...(options.orgDomain ? { org_domain: options.orgDomain } : {}),
  })
    .setProtectedHeader({ alg: "HS256", kid: options.credentialId })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setSubject(options.subject)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "15m")
    .sign(new TextEncoder().encode(secret));
}
