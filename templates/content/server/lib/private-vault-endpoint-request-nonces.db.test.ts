import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `private-vault-endpoint-nonces-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "owner@example.com";
const ORG = "org:nonce-test";
const VAULT = "vault:nonce-test";
const ENDPOINT = "endpoint:nonce-test";
const OTHER_ENDPOINT = "endpoint:nonce-other";
const CLAIMED_AT = "2026-07-17T02:00:00.000Z";
const EXPIRES_AT = "2026-07-17T02:06:00.000Z";

let getDb: (typeof import("../db/index.js"))["getDb"];
let schema: typeof import("../db/schema.js");
let store: (typeof import("./private-vault-endpoint-request-nonces.js"))["sqlPrivateVaultEndpointRequestNonceStore"];

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  await (await import("../plugins/db.js")).default(undefined as never);
  store = (await import("./private-vault-endpoint-request-nonces.js"))
    .sqlPrivateVaultEndpointRequestNonceStore;

  await getDb().insert(schema.contentEncryptedVaults).values({
    vaultId: VAULT,
    ownerEmail: OWNER,
    orgId: ORG,
    accountId: "account:nonce-test",
    workspaceId: "workspace:nonce-test",
    vaultState: "active",
    serverReceivedAt: CLAIMED_AT,
  });
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
    ]);
}, 60_000);

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
    claimedAt: CLAIMED_AT,
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

  it("scopes nonce uniqueness by endpoint and rejects offline endpoints", async () => {
    await expect(claim(OTHER_ENDPOINT)).resolves.toBe(true);
    await getDb()
      .update(schema.contentEncryptedVaultEndpoints)
      .set({ endpointState: "offline" })
      .where(eq(schema.contentEncryptedVaultEndpoints.endpointId, ENDPOINT));
    await expect(claim(ENDPOINT, "cd".repeat(16))).resolves.toBe(false);
  });

  it("retains claims until the exact expiry boundary and cascades endpoint deletion", async () => {
    await expect(store.deleteExpired("2026-07-17T02:05:59.999Z")).resolves.toBe(
      0,
    );
    await expect(store.deleteExpired(EXPIRES_AT)).resolves.toBe(2);

    await getDb()
      .update(schema.contentEncryptedVaultEndpoints)
      .set({ endpointState: "online" })
      .where(eq(schema.contentEncryptedVaultEndpoints.endpointId, ENDPOINT));
    await expect(claim(ENDPOINT, "ef".repeat(16))).resolves.toBe(true);
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
    expect(rows).toEqual([]);
  });
});
