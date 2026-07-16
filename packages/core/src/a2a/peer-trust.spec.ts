import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  A2A_APPROVE_ACTIONS_SCOPE,
  A2A_INVOKE_SCOPE,
  hasUsableA2APeerTrust,
  signA2APeerToken,
  summarizeA2ATrustedPeers,
  verifyTrustedA2APeerToken,
} from "./peer-trust.js";
import type { A2ATrustedPeer } from "./types.js";

const audience = "https://receiver.example";
const issuer = "https://sender.example";
const secretEnv = "A2A_PEER_SENDER_V2_SECRET";

const peer: A2ATrustedPeer = {
  id: "sender",
  issuer,
  audiences: [audience],
  subjects: ["alice@example.test"],
  orgDomains: ["example.test"],
  scopes: [A2A_INVOKE_SCOPE, A2A_APPROVE_ACTIONS_SCOPE],
  credentials: [{ id: "v2", secretEnv }],
};

describe("A2A peer-specific trust", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      [secretEnv]: "peer-specific-example-secret",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function validToken(
    overrides: Partial<Parameters<typeof signA2APeerToken>[0]> = {},
  ) {
    return signA2APeerToken({
      peerId: "sender",
      credentialId: "v2",
      secretEnv,
      issuer,
      audience,
      subject: "alice@example.test",
      scopes: [A2A_INVOKE_SCOPE],
      ...overrides,
    });
  }

  it("accepts only a pinned peer identity with a bounded scope", async () => {
    await expect(
      verifyTrustedA2APeerToken(await validToken(), audience, [peer]),
    ).resolves.toEqual({
      email: "alice@example.test",
      orgDomain: null,
      peerId: "sender",
      scopes: [A2A_INVOKE_SCOPE],
    });
  });

  it("rejects a self-asserted issuer even with the peer key", async () => {
    const token = await validToken({ issuer: "https://attacker.example" });
    await expect(
      verifyTrustedA2APeerToken(token, audience, [peer]),
    ).resolves.toBeNull();
  });

  it("rejects missing and wrong audiences", async () => {
    const secret = new TextEncoder().encode(process.env[secretEnv]);
    const missing = await new jose.SignJWT({
      peer_id: "sender",
      scope: A2A_INVOKE_SCOPE,
    })
      .setProtectedHeader({ alg: "HS256", kid: "v2" })
      .setIssuer(issuer)
      .setSubject("alice@example.test")
      .setExpirationTime("15m")
      .sign(secret);
    await expect(
      verifyTrustedA2APeerToken(missing, audience, [peer]),
    ).resolves.toBeNull();
    await expect(
      verifyTrustedA2APeerToken(
        await validToken({ audience: "https://other.example" }),
        audience,
        [peer],
      ),
    ).resolves.toBeNull();
  });

  it("rejects the wrong peer key and unknown credential id", async () => {
    process.env.A2A_OTHER_PEER_SECRET = "other-peer-example-secret";
    const wrongKey = await validToken({ secretEnv: "A2A_OTHER_PEER_SECRET" });
    await expect(
      verifyTrustedA2APeerToken(wrongKey, audience, [peer]),
    ).resolves.toBeNull();
    const unknownKid = await validToken({ credentialId: "v3" });
    await expect(
      verifyTrustedA2APeerToken(unknownKid, audience, [peer]),
    ).resolves.toBeNull();
  });

  it("rejects overbroad subjects and scopes", async () => {
    await expect(
      verifyTrustedA2APeerToken(
        await validToken({ subject: "mallory@example.test" }),
        audience,
        [peer],
      ),
    ).resolves.toBeNull();
    await expect(
      verifyTrustedA2APeerToken(
        await validToken({ scopes: [A2A_INVOKE_SCOPE, "admin:everything"] }),
        audience,
        [peer],
      ),
    ).resolves.toBeNull();
  });

  it("rejects an organization domain that the peer is not allowed to assert", async () => {
    await expect(
      verifyTrustedA2APeerToken(
        await validToken({ orgDomain: "attacker.example" }),
        audience,
        [peer],
      ),
    ).resolves.toBeNull();
  });

  it("fails closed for revoked peers and revoked or rotated credentials", async () => {
    const token = await validToken();
    await expect(
      verifyTrustedA2APeerToken(token, audience, [{ ...peer, revoked: true }]),
    ).resolves.toBeNull();
    await expect(
      verifyTrustedA2APeerToken(token, audience, [
        {
          ...peer,
          credentials: [{ ...peer.credentials[0], status: "revoked" }],
        },
      ]),
    ).resolves.toBeNull();

    process.env.A2A_PEER_SENDER_V3_SECRET = "rotated-peer-example-secret";
    const rotatedPeer: A2ATrustedPeer = {
      ...peer,
      credentials: [
        { ...peer.credentials[0], status: "revoked" },
        { id: "v3", secretEnv: "A2A_PEER_SENDER_V3_SECRET" },
      ],
    };
    await expect(
      verifyTrustedA2APeerToken(
        await validToken({
          credentialId: "v3",
          secretEnv: "A2A_PEER_SENDER_V3_SECRET",
        }),
        audience,
        [rotatedPeer],
      ),
    ).resolves.toMatchObject({ peerId: "sender" });
  });

  it("reports content-free rotation and revocation totals", () => {
    const now = Date.parse("2026-07-16T12:00:00Z");
    expect(
      summarizeA2ATrustedPeers(
        [
          {
            ...peer,
            credentials: [
              peer.credentials[0],
              { id: "v3", secretEnv: "A2A_PEER_SENDER_V3_SECRET" },
              { id: "old", secretEnv, status: "revoked" },
              {
                id: "future",
                secretEnv,
                notBefore: "2026-07-17T00:00:00Z",
              },
              {
                id: "expired",
                secretEnv,
                expiresAt: "2026-07-15T00:00:00Z",
              },
            ],
          },
          { ...peer, id: "revoked-peer", revoked: true, credentials: [] },
        ],
        now,
      ),
    ).toEqual({
      peers: { active: 1, revoked: 1 },
      credentials: { active: 2, revoked: 1, notYetActive: 1, expired: 1 },
      peersInRotationOverlap: 1,
    });
  });

  it("counts peer auth as configured only with a usable server secret", () => {
    expect(hasUsableA2APeerTrust([peer])).toBe(true);
    delete process.env[secretEnv];
    expect(hasUsableA2APeerTrust([peer])).toBe(false);
    process.env[secretEnv] = "peer-specific-example-secret";
    expect(hasUsableA2APeerTrust([{ ...peer, revoked: true }])).toBe(false);
  });
});
