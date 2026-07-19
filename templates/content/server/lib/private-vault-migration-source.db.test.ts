import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrivateVaultMigrationError,
  hashPrivateVaultMigrationSource,
} from "./private-vault-migration.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `private-vault-migration-source-${process.pid}-${Date.now()}.sqlite`,
);
const scope = {
  ownerEmail: "source-owner@example.test",
  orgId: "org:source",
  vaultId: "21".repeat(16),
};
const root = {
  id: "legacy-root",
  parentId: null,
  title: "Legacy title sentinel",
  content: "Legacy body sentinel",
  description: "Legacy description sentinel",
  icon: null,
  position: 0,
  isFavorite: 0,
  hideFromSearch: 0,
  sourceMode: null,
  sourceKind: null,
  sourcePath: null,
  sourceRootPath: null,
  sourceUpdatedAt: null,
  ownerEmail: scope.ownerEmail,
  orgId: scope.orgId,
  visibility: "private" as const,
  createdAt: "2026-07-19T04:00:00.000Z",
  updatedAt: "2026-07-19T05:00:00.000Z",
};

let getDb: (typeof import("../db/index.js"))["getDb"];
let schema: typeof import("../db/schema.js");
let source: (typeof import("./private-vault-migration-source.js"))["sqlPrivateVaultMigrationSource"];

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  await (await import("../plugins/db.js")).default(undefined as never);
  source = (await import("./private-vault-migration-source.js"))
    .sqlPrivateVaultMigrationSource;
  await getDb()
    .insert(schema.documents)
    .values([
      root,
      {
        ...root,
        id: "legacy-child",
        parentId: root.id,
        title: "Child title",
        content: "Child body",
        position: 1,
      },
    ]);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

describe("Private Vault Standard Cloud migration source", () => {
  it("lists only scoped non-source Standard Cloud document IDs", async () => {
    await expect(source.listCandidateIds(scope)).resolves.toEqual([
      "legacy-child",
      "legacy-root",
    ]);
  });

  it("requires a closed private hierarchy with no unsupported derivatives", async () => {
    await expect(source.freeze(scope, [root.id])).rejects.toBeInstanceOf(
      PrivateVaultMigrationError,
    );
    await expect(
      source.freeze(scope, [root.id, "legacy-child"]),
    ).resolves.toHaveLength(2);
    await getDb().insert(schema.documentVersions).values({
      id: "legacy-version",
      ownerEmail: scope.ownerEmail,
      documentId: root.id,
      title: root.title,
      content: root.content,
      createdAt: root.updatedAt,
    });
    await expect(
      source.freeze(scope, [root.id, "legacy-child"]),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationError);
    await getDb()
      .delete(schema.documentVersions)
      .where(eq(schema.documentVersions.id, "legacy-version"));
    await getDb().insert(schema.documentShares).values({
      id: "legacy-share",
      resourceId: root.id,
      principalType: "user",
      principalId: "recipient@example.test",
      role: "viewer",
      createdBy: scope.ownerEmail,
      createdAt: root.updatedAt,
    });
    await expect(
      source.freeze(scope, [root.id, "legacy-child"]),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationError);
    await getDb()
      .delete(schema.documentShares)
      .where(eq(schema.documentShares.id, "legacy-share"));
    await expect(source.read(scope, root.id)).resolves.toMatchObject({
      id: root.id,
      title: root.title,
      content: root.content,
    });
  });

  it("revalidates exact source digests before deleting plaintext", async () => {
    const frozen = await source.freeze(scope, [root.id, "legacy-child"]);
    const commitments = frozen.map((document) => ({
      sourceDocumentId: document.id,
      sourceDigest: hashPrivateVaultMigrationSource(document),
    }));
    await expect(
      source.cleanup(scope, [
        { ...commitments[0]!, sourceDigest: "ff".repeat(32) },
        commitments[1]!,
      ]),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationError);
    expect(await getDb().select().from(schema.documents)).toHaveLength(2);
    await expect(source.cleanup(scope, commitments)).resolves.toBeUndefined();
    const remaining = await getDb().select().from(schema.documents);
    expect(remaining).toHaveLength(0);
    expect(JSON.stringify(remaining)).not.toContain("Legacy body sentinel");
  });
});
