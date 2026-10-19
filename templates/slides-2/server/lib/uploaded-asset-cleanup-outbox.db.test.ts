import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `slides-asset-cleanup-outbox-${process.pid}-${Date.now()}.pglite`,
);
const originalDatabaseUrl = process.env.DATABASE_URL;
const FUTURE = new Date("2030-01-01T00:00:00.000Z");

let dbModule: typeof import("../db/index.js");
let execModule: typeof import("@agent-native/core/db");
let cleanupModule: typeof import("./uploaded-asset-cleanup-outbox.js");

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  vi.resetModules();
  [execModule, dbModule, cleanupModule] = await Promise.all([
    import("@agent-native/core/db"),
    import("../db/index.js"),
    import("./uploaded-asset-cleanup-outbox.js"),
  ]);
  const exec = execModule.getDbExec();
  await exec.execute(`
    CREATE TABLE uploaded_assets (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL,
      provider TEXT,
      provider_object_id TEXT,
      upload_session_id TEXT,
      font_family TEXT,
      font_variant TEXT,
      deck_id TEXT,
      org_id TEXT,
      owner_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await exec.execute(`
    CREATE TABLE uploaded_asset_cleanup_outbox (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      intent TEXT NOT NULL,
      state TEXT NOT NULL,
      provider TEXT,
      provider_object_id TEXT,
      url TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      lease_expires_at TEXT,
      lease_token TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

afterAll(async () => {
  await execModule.closeDbExec();
  vi.resetModules();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

beforeEach(async () => {
  const exec = execModule.getDbExec();
  await exec.execute("DELETE FROM uploaded_assets");
  await exec.execute("DELETE FROM uploaded_asset_cleanup_outbox");
});

async function expireReservation(assetId: string) {
  await execModule.getDbExec().execute({
    sql: `UPDATE uploaded_asset_cleanup_outbox
          SET lease_expires_at = ? WHERE id = ?`,
    args: ["1970-01-01T00:00:00.000Z", assetId],
  });
}

async function insertAssetAndComplete(
  assetId: string,
  ownerEmail: string,
  orgId: string,
  provider: string,
  providerObjectId: string,
  url: string,
  token: string,
) {
  const cleanupInput = {
    assetId,
    ownerEmail,
    orgId,
    provider,
    providerObjectId,
    url,
    intent: "registration" as const,
  };
  await dbModule.getDb().transaction(async (transaction) => {
    await transaction.insert(dbModule.schema.uploadedAssets).values({
      id: assetId,
      filename: "asset.png",
      url,
      type: "image/png",
      size: 1,
      provider,
      providerObjectId,
      orgId,
      ownerEmail,
    });
    await cleanupModule.completeUploadedAssetRegistration(
      transaction,
      cleanupInput,
      token,
    );
  });
}

describe("uploaded asset cleanup outbox registration lease", () => {
  it("never claims a registration reservation before trusted object metadata exists", async () => {
    const identity = {
      assetId: "metadata-pending",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };
    const token =
      await cleanupModule.reserveUploadedAssetRegistration(identity);
    await expireReservation(identity.assetId);

    await expect(
      cleanupModule.listDueUploadedAssetCleanups({
        ownerEmail: identity.ownerEmail,
        orgId: identity.orgId,
        limit: 10,
        now: FUTURE,
      }),
    ).resolves.toEqual([]);
    await expect(
      cleanupModule.parkUnresolvedUploadedAssetRegistration(identity, token),
    ).resolves.toBe(true);
    await expect(
      cleanupModule.listDueUploadedAssetCleanups({
        ownerEmail: identity.ownerEmail,
        orgId: identity.orgId,
        limit: 10,
        now: FUTURE,
      }),
    ).resolves.toEqual([]);

    const [row] = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.uploadedAssetCleanupOutbox);
    expect(row).toMatchObject({
      id: identity.assetId,
      state: "unresolved",
      intent: "registration",
      provider: null,
      url: null,
      leaseToken: null,
    });
  });

  it("lets the same-row claim win and rolls back a later asset registration", async () => {
    const identity = {
      assetId: "claim-wins",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };
    const token =
      await cleanupModule.reserveUploadedAssetRegistration(identity);
    const cleanupInput = {
      ...identity,
      provider: "trusted-storage",
      providerObjectId: "objects/claim-wins.png",
      url: "https://storage.example.com/claim-wins.png",
      intent: "registration" as const,
    };
    await expect(
      cleanupModule.recordUploadedAssetCleanupObject(cleanupInput, token),
    ).resolves.toBe(true);
    await expireReservation(identity.assetId);

    const [candidate] = await cleanupModule.listDueUploadedAssetCleanups({
      ownerEmail: identity.ownerEmail,
      orgId: identity.orgId,
      limit: 10,
      now: FUTURE,
    });
    expect(candidate).toBeDefined();
    const claimed = await cleanupModule.claimDueUploadedAssetCleanup(
      candidate!,
      FUTURE,
    );
    expect(claimed).toMatchObject({ state: "claimed", intent: "registration" });
    expect(claimed?.leaseToken).not.toBe(token);
    await expect(
      cleanupModule.claimDueUploadedAssetCleanup(candidate!, FUTURE),
    ).resolves.toBeNull();

    await expect(
      insertAssetAndComplete(
        identity.assetId,
        identity.ownerEmail,
        identity.orgId,
        "trusted-storage",
        "objects/claim-wins.png",
        "https://storage.example.com/claim-wins.png",
        token,
      ),
    ).rejects.toThrow("Uploaded asset registration reservation was claimed.");

    const assets = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.uploadedAssets);
    expect(assets).toEqual([]);
    const [outboxRow] = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.uploadedAssetCleanupOutbox);
    expect(outboxRow).toMatchObject({
      id: identity.assetId,
      state: "claimed",
      intent: "registration",
      leaseToken: claimed?.leaseToken,
    });
  });

  it("lets the atomic asset insert and registration completion defeat a stale claim", async () => {
    const identity = {
      assetId: "registration-wins",
      ownerEmail: "owner@example.com",
      orgId: "org-1",
    };
    const token =
      await cleanupModule.reserveUploadedAssetRegistration(identity);
    const cleanupInput = {
      ...identity,
      provider: "trusted-storage",
      providerObjectId: "objects/registration-wins.png",
      url: "https://storage.example.com/registration-wins.png",
      intent: "registration" as const,
    };
    await expect(
      cleanupModule.recordUploadedAssetCleanupObject(cleanupInput, token),
    ).resolves.toBe(true);
    await expireReservation(identity.assetId);
    const [candidate] = await cleanupModule.listDueUploadedAssetCleanups({
      ownerEmail: identity.ownerEmail,
      orgId: identity.orgId,
      limit: 10,
      now: FUTURE,
    });
    expect(candidate).toBeDefined();

    await insertAssetAndComplete(
      identity.assetId,
      identity.ownerEmail,
      identity.orgId,
      "trusted-storage",
      "objects/registration-wins.png",
      "https://storage.example.com/registration-wins.png",
      token,
    );
    await expect(
      cleanupModule.claimDueUploadedAssetCleanup(candidate!, FUTURE),
    ).resolves.toBeNull();

    const [asset] = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.uploadedAssets);
    expect(asset).toMatchObject({
      id: identity.assetId,
      ownerEmail: identity.ownerEmail,
    });
    const [outboxRow] = await dbModule
      .getDb()
      .select()
      .from(dbModule.schema.uploadedAssetCleanupOutbox);
    expect(outboxRow).toMatchObject({
      id: identity.assetId,
      state: "registered",
      intent: "registration",
      leaseToken: token,
    });
  });
});
