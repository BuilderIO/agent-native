import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runFrameworkReleaseMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// guard:allow-unscoped — isolated test database verifies receipt atomicity and permission fixtures.
const path = join(
  tmpdir(),
  `content-setup-${process.pid}-${Date.now()}.pglite`,
);
const databaseUrl = process.env.CONTENT_SETUP_POSTGRES_URL ?? `pglite:${path}`;
const runId = Date.now();
const owner = `setup-owner-${runId}@example.com`;
const outsider = `setup-outsider-${runId}@example.com`;
let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let create: typeof import("./create-content-database.js").default;
let read: typeof import("./get-content-database.js").default;
let describeDatabase: typeof import("./describe-content-database.js").default;
let trash: typeof import("./delete-content-database.js").default;
let restore: typeof import("./restore-content-database.js").default;
let listSpaces: typeof import("./list-content-spaces.js").default;
let spaceId: string;
const as = <T>(email: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: email }, run);

beforeAll(async () => {
  if (
    databaseUrl.startsWith("postgres") &&
    !new URL(databaseUrl).pathname.includes("test")
  )
    throw new Error(
      "CONTENT_SETUP_POSTGRES_URL must be an isolated test database",
    );
  process.env.DATABASE_URL = databaseUrl;
  const db = await import("../server/db/index.js");
  getDb = db.getDb;
  schema = db.schema;
  if (databaseUrl.startsWith("postgres"))
    await runFrameworkReleaseMigrations(undefined);
  await (await import("../server/plugins/db.js")).default(undefined as never);
  create = (await import("./create-content-database.js")).default;
  read = (await import("./get-content-database.js")).default;
  describeDatabase = (await import("./describe-content-database.js")).default;
  trash = (await import("./delete-content-database.js")).default;
  restore = (await import("./restore-content-database.js")).default;
  listSpaces = (await import("./list-content-spaces.js")).default;
  await as(owner, () =>
    import("./_content-spaces.js").then((m) =>
      m.provisionContentSpaces(getDb(), owner),
    ),
  );
  const spaces = await as(owner, () => listSpaces.run({}));
  spaceId = spaces.spaces[0].id;
});

afterAll(() => {
  if (!databaseUrl.startsWith("postgres"))
    rmSync(path, { recursive: true, force: true });
});

describe("ordinary database setup", () => {
  it("preserves the UI optimistic Page identity through the shared reliable create path", async () => {
    const newDocumentId = `optimistic-${runId}`;
    const args = {
      spaceId,
      title: "UI table",
      newDocumentId,
      parentId: null,
      idempotencyKey: newDocumentId,
    };
    const created = await as(owner, () => create.run(args));
    const replayed = await as(owner, () => create.run(args));
    expect(created.database.documentId).toBe(newDocumentId);
    expect(replayed.database.id).toBe(created.database.id);
    expect(replayed.receipt?.idempotency.result).toBe("replayed");
    expect(create.tool.parameters?.properties).not.toHaveProperty(
      "newDocumentId",
    );
  });
  it("DB01–DB02 creates once across concurrent retries with exact scope and discoverable default view", async () => {
    const args = {
      spaceId,
      title: "Campaign tracker",
      idempotencyKey: "same-create",
    };
    const results = await Promise.all([
      as(owner, () => create.run(args)),
      as(owner, () => create.run(args)),
    ]);
    expect(results[0].database.id).toBe(results[1].database.id);
    expect(results.map((r) => r.receipt!.idempotency.result).sort()).toEqual([
      "applied",
      "replayed",
    ]);
    const description = await as(owner, () =>
      describeDatabase.run({ databaseId: results[0].database.id }),
    );
    expect(description).toMatchObject({
      database: { spaceId, title: "Campaign tracker" },
      setupContract: { canEditSchema: true, sourceComposition: "unsupported" },
    });
    expect(
      "mutationContract" in description &&
        description.mutationContract?.target.databaseId,
    ).toBe(results[0].database.id);
    expect(
      "configurationRevision" in description &&
        description.configurationRevision,
    ).toBe(results[0].receipt!.revisions.configurationAfter);
    expect(
      results[0].properties.filter((p) => p.definition.type === "blocks"),
    ).toHaveLength(1);
    await expect(
      as(owner, () => create.run({ ...args, title: "Different intent" })),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("DB07 refuses other principals and rolls back a mismatched parent/space without an orphan claim", async () => {
    await expect(
      as(outsider, () =>
        create.run({ spaceId, title: "Denied", idempotencyKey: "denied" }),
      ),
    ).rejects.toThrow();
    const parent = await as(owner, () =>
      create.run({ spaceId, title: "Parent", idempotencyKey: "parent" }),
    );
    await as(outsider, () =>
      import("./_content-spaces.js").then((m) =>
        m.provisionContentSpaces(getDb(), outsider),
      ),
    );
    const foreign = await as(outsider, () => listSpaces.run({}));
    await expect(
      as(owner, () =>
        create.run({
          spaceId: foreign.spaces[0].id,
          parentId: parent.database.documentId,
          title: "Wrong space",
          idempotencyKey: "bad-parent",
        }),
      ),
    ).rejects.toThrow();
    const claims = await getDb()
      .select()
      .from(schema.contentDatabaseSetupReceipts)
      .where(
        eq(schema.contentDatabaseSetupReceipts.idempotencyKey, "bad-parent"),
      );
    expect(claims).toHaveLength(0);
    await expect(
      as(outsider, () =>
        create.run({ spaceId, title: "Parent", idempotencyKey: "parent" }),
      ),
    ).rejects.toThrow();
  });

  it("DB06/DB12 guards Trash and restore revisions, preserves identities and replays without mutation", async () => {
    const created = await as(owner, () =>
      create.run({
        spaceId,
        title: "Recoverable",
        idempotencyKey: "recoverable",
      }),
    );
    const target = {
      spaceId,
      databaseId: created.database.id,
      databaseDocumentId: created.database.documentId,
    };
    const input = {
      target,
      expectedConfigurationRevision:
        created.receipt!.revisions.configurationAfter,
      idempotencyKey: "trash-once",
    };
    await expect(
      as(owner, () =>
        trash.run({ ...input, expectedConfigurationRevision: "stale" }),
      ),
    ).rejects.toMatchObject({ errorCode: "CONFIGURATION_REVISION_CONFLICT" });
    const deleted = await as(owner, () => trash.run(input));
    expect(deleted.receipt?.outcome).toBe("trashed");
    expect(
      (await as(owner, () => trash.run(input))).receipt?.idempotency.result,
    ).toBe("replayed");
    await expect(
      as(owner, () => describeDatabase.run({ databaseId: target.databaseId })),
    ).rejects.toThrow();
    const restored = await as(owner, () =>
      restore.run({
        target,
        expectedConfigurationRevision:
          deleted.receipt!.revisions.configurationAfter,
        idempotencyKey: "restore-once",
      }),
    );
    expect(restored.receipt?.outcome).toBe("restored");
    const fresh = await as(owner, () =>
      read.run({ databaseId: target.databaseId }),
    );
    expect(fresh).toMatchObject({
      database: {
        id: target.databaseId,
        documentId: target.databaseDocumentId,
        title: "Recoverable",
      },
    });
    const receipts = await getDb()
      .select()
      .from(schema.contentDatabaseSetupReceipts)
      .where(
        and(
          eq(schema.contentDatabaseSetupReceipts.databaseId, target.databaseId),
          eq(schema.contentDatabaseSetupReceipts.actorEmail, owner),
        ),
      );
    expect(receipts).toHaveLength(3);
    await expect(as(outsider, () => trash.run(input))).rejects.toThrow();
  });

  it("DB11 refuses an unreadable or incomplete durable receipt instead of applying creation again", async () => {
    const args = {
      spaceId,
      title: "Receipt integrity",
      idempotencyKey: "receipt-integrity",
    };
    const created = await as(owner, () => create.run(args));
    await getDb()
      .update(schema.contentDatabaseSetupReceipts)
      .set({ resultJson: "invalid-json" })
      .where(
        eq(schema.contentDatabaseSetupReceipts.id, created.receipt!.receiptId),
      );
    await expect(as(owner, () => create.run(args))).rejects.toMatchObject({
      errorCode: "RECEIPT_MISMATCH",
    });
    await getDb()
      .update(schema.contentDatabaseSetupReceipts)
      .set({ resultJson: null })
      .where(
        eq(schema.contentDatabaseSetupReceipts.id, created.receipt!.receiptId),
      );
    await expect(as(owner, () => create.run(args))).rejects.toMatchObject({
      errorCode: "RECEIPT_MISMATCH",
    });
    const databases = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.spaceId, spaceId),
          eq(schema.contentDatabases.title, args.title),
        ),
      );
    expect(databases).toHaveLength(1);
  });

  it("DB11 refuses readable lifecycle receipts with a corrupted target or intent key", async () => {
    const created = await as(owner, () =>
      create.run({
        spaceId,
        title: "Exact receipt",
        idempotencyKey: "exact-receipt-create",
      }),
    );
    const target = {
      spaceId,
      databaseId: created.database.id,
      databaseDocumentId: created.database.documentId,
    };
    const args = {
      target,
      expectedConfigurationRevision:
        created.receipt!.revisions.configurationAfter,
      idempotencyKey: "exact-receipt-trash",
    };
    const result = await as(owner, () => trash.run(args));
    const [claim] = await getDb()
      .select()
      .from(schema.contentDatabaseSetupReceipts)
      .where(
        eq(schema.contentDatabaseSetupReceipts.id, result.receipt!.receiptId),
      );
    for (const field of ["spaceId", "databaseDocumentId", "key"]) {
      const corrupted = JSON.parse(claim.resultJson!);
      if (field === "key") corrupted.receipt.idempotency.key = "wrong-key";
      else corrupted.receipt.target[field] = "wrong-target";
      await getDb()
        .update(schema.contentDatabaseSetupReceipts)
        .set({ resultJson: JSON.stringify(corrupted) })
        .where(eq(schema.contentDatabaseSetupReceipts.id, claim.id));
      await expect(as(owner, () => trash.run(args))).rejects.toMatchObject({
        errorCode: "RECEIPT_MISMATCH",
      });
    }
  });
});
