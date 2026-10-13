import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-get-trashed-document-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "trashed-owner@example.com";
const MEMBER = "trashed-member@example.com";
const OUTSIDER = "trashed-outsider@example.com";
const ORGANIZATION_ID = "trashed-organization";
const SPACE_ID = "trashed-organization-space";

let getTrashedDocument: typeof import("./get-trashed-document.js").default;

// A member with no active organization reaches the space's Pages only
// through the space.
function readAs(userEmail: string, params: Record<string, unknown>) {
  return runWithRequestContext({ userEmail }, () =>
    getTrashedDocument.run(params as any),
  );
}

async function statusOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode;
  }
  throw new Error("Expected the read to fail");
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const { getDb, schema } = await import("../server/db/index.js");
  getTrashedDocument = (await import("./get-trashed-document.js")).default;
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
    args: [ORGANIZATION_ID, "Trashed Org", OWNER, Date.now()],
  });
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
    args: ["trashed-member", ORGANIZATION_ID, MEMBER, "member", Date.now()],
  });

  const now = new Date().toISOString();
  await getDb().insert(schema.contentSpaces).values({
    id: SPACE_ID,
    name: "Trashed Org",
    kind: "organization",
    ownerEmail: OWNER,
    orgId: ORGANIZATION_ID,
    filesDatabaseId: "trashed-organization-files",
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
  await getDb()
    .insert(schema.documents)
    .values([
      {
        id: "trashed-parent",
        spaceId: SPACE_ID,
        ownerEmail: OWNER,
        orgId: ORGANIZATION_ID,
        title: "Launch plan",
        content: "",
        visibility: "private",
        trashedAt: now,
        trashRootId: "trashed-parent",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "trashed-child",
        spaceId: SPACE_ID,
        ownerEmail: OWNER,
        orgId: ORGANIZATION_ID,
        parentId: "trashed-parent",
        title: "Launch checklist",
        content: "Secret body",
        visibility: "private",
        trashedAt: now,
        trashRootId: "trashed-parent",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  // A share with the organization holds only while it is the active one,
  // which the space makes it for its members.
  await getDb()
    .insert(schema.documentShares)
    .values(
      ["trashed-parent", "trashed-child"].map((resourceId) => ({
        id: `share-${resourceId}`,
        resourceId,
        principalType: "org",
        principalId: ORGANIZATION_ID,
        role: "viewer",
        createdBy: OWNER,
        createdAt: now,
      })),
    );
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("get-trashed-document", () => {
  it("lets a member of the page's space read it from Trash", async () => {
    expect(await readAs(MEMBER, { id: "trashed-child" })).toMatchObject({
      id: "trashed-child",
      content: "Secret body",
    });
  });

  it("returns only where the restore starts when asked", async () => {
    expect(
      await readAs(MEMBER, { id: "trashed-child", trashRootOnly: true }),
    ).toEqual({ id: "trashed-child", trashRootId: "trashed-parent" });
  });

  it("refuses someone outside the space as if the page weren't there", async () => {
    expect(await statusOf(readAs(OUTSIDER, { id: "trashed-child" }))).toBe(404);
    expect(
      await statusOf(
        readAs(OUTSIDER, { id: "trashed-child", trashRootOnly: true }),
      ),
    ).toBe(404);
  });
});
