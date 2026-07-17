import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CONTENT_PRIVATE_VAULT_REPLAY_FENCE_CONTRACT } from "../../shared/private-vault-replay-fence.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `private-vault-endpoint-nonces-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "owner@example.com";
const ORG = "org:nonce-test";
const VAULT = "vault:nonce-test";
const ENDPOINT = "endpoint:nonce-test";
const OTHER_ENDPOINT = "endpoint:nonce-other";
const SECOND_OWNER = "second-owner@example.com";
const SECOND_ORG = "org:nonce-test-second";
const SECOND_VAULT = "vault:nonce-test-second";
const SECOND_ENDPOINT = "endpoint:nonce-test-second";
const CLAIMED_AT = "2026-07-17T02:00:00.000Z";
const EXPIRES_AT = "2026-07-17T02:06:00.000Z";

let getDb: (typeof import("../db/index.js"))["getDb"];
let schema: typeof import("../db/schema.js");
let store: ReturnType<
  (typeof import("./private-vault-endpoint-request-nonces.js"))["createPrivateVaultEndpointRequestNonceStore"]
>;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  await (await import("../plugins/db.js")).default(undefined as never);
  store = (
    await import("./private-vault-endpoint-request-nonces.js")
  ).createPrivateVaultEndpointRequestNonceStore({
    now: () => new Date(CLAIMED_AT),
  });

  await getDb()
    .insert(schema.contentEncryptedVaults)
    .values([
      {
        vaultId: VAULT,
        ownerEmail: OWNER,
        orgId: ORG,
        accountId: "account:nonce-test",
        workspaceId: "workspace:nonce-test",
        vaultState: "active",
        serverReceivedAt: CLAIMED_AT,
      },
      {
        vaultId: SECOND_VAULT,
        ownerEmail: SECOND_OWNER,
        orgId: SECOND_ORG,
        accountId: "account:nonce-test-second",
        workspaceId: "workspace:nonce-test-second",
        vaultState: "active",
        serverReceivedAt: CLAIMED_AT,
      },
    ]);
  await getDb()
    .insert(schema.contentEncryptedVaultEndpoints)
    .values([
      {
        endpointId: ENDPOINT,
        vaultId: VAULT,
        ownerEmail: OWNER,
        orgId: ORG,
        endpointState: "online",
        publicIdentityJson: JSON.stringify({
          algorithmId: "ed25519",
          publicIdentity: "synthetic-public-identity-one",
        }),
        healthState: "healthy",
        serverReceivedAt: CLAIMED_AT,
      },
      {
        endpointId: OTHER_ENDPOINT,
        vaultId: VAULT,
        ownerEmail: OWNER,
        orgId: ORG,
        endpointState: "online",
        publicIdentityJson: JSON.stringify({
          algorithmId: "ed25519",
          publicIdentity: "synthetic-public-identity-two",
        }),
        healthState: "healthy",
        serverReceivedAt: CLAIMED_AT,
      },
      {
        endpointId: SECOND_ENDPOINT,
        vaultId: SECOND_VAULT,
        ownerEmail: SECOND_OWNER,
        orgId: SECOND_ORG,
        endpointState: "online",
        publicIdentityJson: JSON.stringify({
          algorithmId: "ed25519",
          publicIdentity: "synthetic-public-identity-second-tenant",
        }),
        healthState: "healthy",
        serverReceivedAt: CLAIMED_AT,
      },
    ]);
}, 60_000);

beforeEach(async () => {
  await getDb().delete(schema.contentEncryptedVaultEndpointRequestNonces);
  await getDb().delete(schema.contentEncryptedVaultEndpointRequestNoncesLegacy);
  await getDb()
    .update(schema.contentEncryptedVaultEndpoints)
    .set({ endpointState: "online" })
    .where(eq(schema.contentEncryptedVaultEndpoints.endpointState, "offline"));
});

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

function claim(endpointId = ENDPOINT, nonce = "ab".repeat(16)) {
  return store.claim({
    ownerEmail: OWNER,
    orgId: ORG,
    vaultId: VAULT,
    endpointId,
    nonce,
    expiresAt: EXPIRES_AT,
  });
}

describe("Private Vault durable endpoint-request replay fence", () => {
  it("atomically accepts exactly one of twenty concurrent identical claims", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => claim()),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("bridges an unexpired v79 claim until expiry without new raw nonce writes", async () => {
    const legacyNonce = "ac".repeat(16);
    await getDb()
      .insert(schema.contentEncryptedVaultEndpointRequestNoncesLegacy)
      .values({
        id: "legacy-live-claim",
        vaultId: VAULT,
        endpointId: ENDPOINT,
        ownerEmail: OWNER,
        orgId: ORG,
        nonce: legacyNonce,
        claimedAt: "2026-07-16T22:00:00.000-04:00",
        expiresAt: "2026-07-16T22:06:00.000-04:00",
      });

    await expect(store.bridgeLegacyClaims(CLAIMED_AT)).resolves.toBe(1);
    await expect(store.bridgeLegacyClaims(CLAIMED_AT)).resolves.toBe(0);
    await getDb()
      .delete(schema.contentEncryptedVaultEndpoints)
      .where(eq(schema.contentEncryptedVaultEndpoints.endpointId, ENDPOINT));
    await getDb()
      .insert(schema.contentEncryptedVaultEndpoints)
      .values({
        endpointId: ENDPOINT,
        vaultId: VAULT,
        ownerEmail: OWNER,
        orgId: ORG,
        endpointState: "online",
        publicIdentityJson: JSON.stringify({
          algorithmId: "ed25519",
          publicIdentity: "synthetic-public-identity-after-v79-bridge",
        }),
        healthState: "healthy",
        serverReceivedAt: CLAIMED_AT,
      });
    await expect(claim(ENDPOINT, legacyNonce)).resolves.toBe(false);
    await expect(claim(ENDPOINT, "bd".repeat(16))).resolves.toBe(true);
    await expect(
      getDb()
        .select()
        .from(schema.contentEncryptedVaultEndpointRequestNoncesLegacy),
    ).resolves.toHaveLength(0);

    await expect(store.deleteExpired(EXPIRES_AT)).resolves.toBe(2);
    await expect(
      getDb()
        .select()
        .from(schema.contentEncryptedVaultEndpointRequestNoncesLegacy),
    ).resolves.toEqual([]);
  });

  it("bridges legacy claims in SQLite-safe idempotent batches", async () => {
    const legacyClaims = Array.from({ length: 130 }, (_, index) => ({
      id: `legacy-batch-${index.toString().padStart(3, "0")}`,
      vaultId: VAULT,
      endpointId: ENDPOINT,
      ownerEmail: OWNER,
      orgId: ORG,
      nonce: index.toString(16).padStart(64, "0"),
      claimedAt: "2026-07-16T22:00:00.000-04:00",
      expiresAt: "2026-07-16T22:06:00.000-04:00",
    }));
    for (let offset = 0; offset < legacyClaims.length; offset += 40) {
      await getDb()
        .insert(schema.contentEncryptedVaultEndpointRequestNoncesLegacy)
        .values(legacyClaims.slice(offset, offset + 40));
    }

    await expect(store.bridgeLegacyClaims(CLAIMED_AT)).resolves.toBe(130);
    await expect(store.bridgeLegacyClaims(CLAIMED_AT)).resolves.toBe(0);
    await expect(
      getDb().select().from(schema.contentEncryptedVaultEndpointRequestNonces),
    ).resolves.toHaveLength(130);
  });

  it("scopes nonce uniqueness by endpoint and rejects offline endpoints", async () => {
    await expect(claim()).resolves.toBe(true);
    await expect(claim(OTHER_ENDPOINT)).resolves.toBe(true);
    await expect(
      store.claim({
        ownerEmail: "attacker@example.com",
        orgId: ORG,
        vaultId: VAULT,
        endpointId: ENDPOINT,
        nonce: "cd".repeat(16),
        expiresAt: EXPIRES_AT,
      }),
    ).resolves.toBe(false);
    await getDb()
      .update(schema.contentEncryptedVaultEndpoints)
      .set({ endpointState: "offline" })
      .where(eq(schema.contentEncryptedVaultEndpoints.endpointId, ENDPOINT));
    await expect(claim(ENDPOINT, "ef".repeat(16))).resolves.toBe(false);
  });

  it("isolates real tenant coordinates while allowing independent same-nonce claims", async () => {
    const sharedNonce = "89".repeat(16);
    await expect(claim(ENDPOINT, sharedNonce)).resolves.toBe(true);
    await expect(
      store.claim({
        ownerEmail: SECOND_OWNER,
        orgId: SECOND_ORG,
        vaultId: SECOND_VAULT,
        endpointId: SECOND_ENDPOINT,
        nonce: sharedNonce,
        expiresAt: EXPIRES_AT,
      }),
    ).resolves.toBe(true);
    for (const mixed of [
      { ownerEmail: SECOND_OWNER, orgId: ORG, vaultId: VAULT },
      { ownerEmail: OWNER, orgId: SECOND_ORG, vaultId: VAULT },
      { ownerEmail: OWNER, orgId: ORG, vaultId: SECOND_VAULT },
    ]) {
      await expect(
        store.claim({
          ...mixed,
          endpointId: SECOND_ENDPOINT,
          nonce: "9a".repeat(16),
          expiresAt: EXPIRES_AT,
        }),
      ).resolves.toBe(false);
    }

    await getDb()
      .delete(schema.contentEncryptedVaultEndpoints)
      .where(eq(schema.contentEncryptedVaultEndpoints.endpointId, ENDPOINT));
    const surviving = await getDb()
      .select()
      .from(schema.contentEncryptedVaultEndpointRequestNonces)
      .where(
        eq(
          schema.contentEncryptedVaultEndpointRequestNonces.vaultId,
          SECOND_VAULT,
        ),
      );
    expect(surviving).toHaveLength(1);
    await getDb()
      .insert(schema.contentEncryptedVaultEndpoints)
      .values({
        endpointId: ENDPOINT,
        vaultId: VAULT,
        ownerEmail: OWNER,
        orgId: ORG,
        endpointState: "online",
        publicIdentityJson: JSON.stringify({
          algorithmId: "ed25519",
          publicIdentity: "synthetic-public-identity-restored",
        }),
        healthState: "healthy",
        serverReceivedAt: CLAIMED_AT,
      });
  });

  it("retains claims through endpoint deletion and the exact coarse expiry boundary", async () => {
    await expect(claim(ENDPOINT, "01".repeat(16))).resolves.toBe(true);
    await expect(claim(OTHER_ENDPOINT, "02".repeat(16))).resolves.toBe(true);
    await expect(store.deleteExpired("2026-07-17T02:05:59.999Z")).resolves.toBe(
      0,
    );
    await expect(store.deleteExpired(EXPIRES_AT)).resolves.toBe(2);

    const replayNonce = "03".repeat(16);
    await expect(claim(ENDPOINT, replayNonce)).resolves.toBe(true);
    await getDb()
      .delete(schema.contentEncryptedVaultEndpoints)
      .where(eq(schema.contentEncryptedVaultEndpoints.endpointId, ENDPOINT));
    const rows = await getDb()
      .select()
      .from(schema.contentEncryptedVaultEndpointRequestNonces)
      .where(
        eq(
          schema.contentEncryptedVaultEndpointRequestNonces.endpointId,
          ENDPOINT,
        ),
      );
    expect(rows).toHaveLength(1);

    await getDb()
      .insert(schema.contentEncryptedVaultEndpoints)
      .values({
        endpointId: ENDPOINT,
        vaultId: VAULT,
        ownerEmail: OWNER,
        orgId: ORG,
        endpointState: "online",
        publicIdentityJson: JSON.stringify({
          algorithmId: "ed25519",
          publicIdentity: "synthetic-public-identity-recreated",
        }),
        healthState: "healthy",
        serverReceivedAt: CLAIMED_AT,
      });
    await expect(claim(ENDPOINT, replayNonce)).resolves.toBe(false);
  });

  it("accepts delayed valid expiry, rejects overlong expiry, and stores no raw nonce", async () => {
    const rawNonce = "45".repeat(16);
    await expect(
      store.claim({
        ownerEmail: OWNER,
        orgId: ORG,
        vaultId: VAULT,
        endpointId: ENDPOINT,
        nonce: rawNonce,
        expiresAt: "2026-07-16T22:05:00.000-04:00",
      }),
    ).resolves.toBe(true);
    await expect(
      store.claim({
        ownerEmail: OWNER,
        orgId: ORG,
        vaultId: VAULT,
        endpointId: ENDPOINT,
        nonce: "67".repeat(16),
        expiresAt: "2026-07-17T02:06:30.001Z",
      }),
    ).resolves.toBe(false);
    const rows = await getDb()
      .select()
      .from(schema.contentEncryptedVaultEndpointRequestNonces);
    const legacyRows = await getDb()
      .select()
      .from(schema.contentEncryptedVaultEndpointRequestNoncesLegacy);
    expect(JSON.stringify(rows)).not.toContain(rawNonce);
    expect(legacyRows).toEqual([]);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [...CONTENT_PRIVATE_VAULT_REPLAY_FENCE_CONTRACT.physicalFields].sort(),
    );
    expect(rows[0]).toMatchObject({
      claimedAtBucket: Date.parse(CLAIMED_AT),
      expiresAtBucket: Date.parse("2026-07-17T02:05:00.000Z"),
    });
  });

  it("purges an expired backlog larger than one thousand in one durable sweep", async () => {
    const claims = Array.from({ length: 1_001 }, (_, index) => ({
      id: `expired-${index.toString().padStart(4, "0")}`,
      vaultId: VAULT,
      endpointId: OTHER_ENDPOINT,
      ownerEmail: OWNER,
      orgId: ORG,
      version: 1,
      nonceDigest: index.toString(16).padStart(64, "0"),
      claimedAtBucket: Date.parse("2026-07-16T00:00:00.000Z"),
      expiresAtBucket: Date.parse("2026-07-16T00:06:00.000Z"),
    }));
    for (let offset = 0; offset < claims.length; offset += 250) {
      await getDb()
        .insert(schema.contentEncryptedVaultEndpointRequestNonces)
        .values(claims.slice(offset, offset + 250));
    }
    await expect(store.deleteExpired(CLAIMED_AT)).resolves.toBe(1_001);
    await expect(
      getDb().select().from(schema.contentEncryptedVaultEndpointRequestNonces),
    ).resolves.toEqual([]);
  });
});
