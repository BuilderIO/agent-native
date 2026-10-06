import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { resolveAccessStatus } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-restore-document-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "restore-owner@example.com";
const MEMBER = "restore-member@example.com";
const OUTSIDER = "restore-outsider@example.com";
const ORGANIZATION_ID = "restore-organization";
const SPACE_ID = "restore-organization-space";

let restoreDocument: typeof import("./restore-document.js").default;
let db: typeof import("../server/db/index.js");

// No active organization: the member reaches the space's Pages only through
// the space.
function as<T>(userEmail: string, fn: () => Promise<T>) {
  return runWithRequestContext({ userEmail }, fn);
}

async function trashedAt(id: string) {
  const [row] = await db
    .getDb()
    .select({ trashedAt: db.schema.documents.trashedAt })
    .from(db.schema.documents)
    .where(eq(db.schema.documents.id, id));
  return row?.trashedAt ?? null;
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  db = await import("../server/db/index.js");
  restoreDocument = (await import("./restore-document.js")).default;
  await (await import("../server/plugins/db.js")).default(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await getDbExec().execute({
    sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
    args: [ORGANIZATION_ID, "Restore Org", OWNER, Date.now()],
  });
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
    args: ["restore-member", ORGANIZATION_ID, MEMBER, "member", Date.now()],
  });

  const now = new Date().toISOString();
  await db.getDb().insert(db.schema.contentSpaces).values({
    id: SPACE_ID,
    name: "Restore Org",
    kind: "organization",
    ownerEmail: OWNER,
    orgId: ORGANIZATION_ID,
    filesDatabaseId: "restore-organization-files",
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .getDb()
    .insert(db.schema.documents)
    .values(
      ["outsider-attempt", "member-restores"].map((id) => ({
        id,
        spaceId: SPACE_ID,
        ownerEmail: OWNER,
        orgId: ORGANIZATION_ID,
        title: "Launch plan",
        content: "",
        visibility: "private" as const,
        trashedAt: now,
        trashRootId: id,
        createdAt: now,
        updatedAt: now,
      })),
    );
  await db
    .getDb()
    .insert(db.schema.documentShares)
    .values(
      ["outsider-attempt", "member-restores"].map((resourceId) => ({
        id: `share-${resourceId}`,
        resourceId,
        principalType: "org",
        principalId: ORGANIZATION_ID,
        role: "admin",
        createdBy: OWNER,
        createdAt: now,
      })),
    );
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("restore-document", () => {
  it("restores for a space member the access screen offers Restore to", async () => {
    expect(
      await as(MEMBER, () =>
        resolveAccessStatus("document", "member-restores"),
      ),
    ).toMatchObject({ state: "trashed", role: "admin" });

    await as(MEMBER, () => restoreDocument.run({ id: "member-restores" }));

    expect(await trashedAt("member-restores")).toBeNull();
  });

  it("refuses someone outside the space", async () => {
    await expect(
      as(OUTSIDER, () => restoreDocument.run({ id: "outsider-attempt" })),
    ).rejects.toThrow();
    expect(await trashedAt("outsider-attempt")).not.toBeNull();
  });
});
