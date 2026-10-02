import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { ownableColumns, table, text } from "../db/schema.js";
import { runWithRequestContext } from "../server/request-context.js";
import { resolveAccessStatus } from "./access.js";
import getResourceAccessStatus from "./actions/get-resource-access-status.js";
import { registerShareableResource } from "./registry.js";
import { createSharesTable } from "./schema.js";

const resourceType = "qa-status-doc";
const plainType = "qa-status-plain";
const managedType = "qa-status-managed";
const strictType = "qa-status-strict";
const ownerEmail = "owner+status@example.com";
const viewerEmail = "viewer+status@example.com";
const outsiderEmail = "outsider+status@example.com";
const adminEmail = "admin+status@example.com";

const docs = table("qa_status_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  trashedAt: text("trashed_at"),
  ...ownableColumns(),
});
const docShares = createSharesTable("qa_status_doc_shares");

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let db: ReturnType<typeof drizzle>;

async function insertDoc(values: {
  id: string;
  trashedAt?: string | null;
  visibility?: "private" | "org" | "public";
}) {
  await db.insert(docs).values({
    id: values.id,
    title: `Secret title ${values.id}`,
    trashedAt: values.trashedAt ?? null,
    ownerEmail,
    orgId: null,
    visibility: values.visibility ?? "private",
  });
}

async function shareWith(resourceId: string, email: string) {
  await db.insert(docShares).values({
    id: `share-${resourceId}-${email}`,
    resourceId,
    principalType: "user",
    principalId: email,
    role: "viewer",
    createdBy: ownerEmail,
    createdAt: new Date().toISOString(),
  });
}

function statusAs(
  userEmail: string | undefined,
  resourceId: string,
  type = resourceType,
) {
  return runWithRequestContext({ userEmail }, () =>
    resolveAccessStatus(type, resourceId),
  );
}

beforeEach(async () => {
  pglite = await createTestPglite();
  await pglite.exec(`
    CREATE TABLE qa_status_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      trashed_at TEXT,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE qa_status_doc_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notified_at TEXT
    );
  `);
  db = drizzle(pglite.db);
  registerShareableResource({
    type: resourceType,
    resourceTable: docs,
    sharesTable: docShares,
    displayName: "QA Doc",
    titleColumn: "title",
    getDb: () => db,
    availability: {
      columns: ["trashedAt"],
      isAvailable: (doc) => !doc.trashedAt,
    },
  });
  registerShareableResource({
    type: plainType,
    resourceTable: docs,
    sharesTable: docShares,
    displayName: "QA Doc",
    getDb: () => db,
  });
});

afterEach(async () => {
  await pglite.close();
});

describe("resolveAccessStatus", () => {
  it("lets the owner and an invitee open a page, with their role", async () => {
    await insertDoc({ id: "open" });
    await shareWith("open", viewerEmail);

    expect(await statusAs(ownerEmail, "open")).toEqual({
      state: "allowed",
      role: "owner",
    });
    expect(await statusAs(viewerEmail, "open")).toEqual({
      state: "allowed",
      role: "viewer",
    });
  });

  it("tells a signed-in outsider that a private page exists and nothing else", async () => {
    await insertDoc({ id: "private" });

    expect(await statusAs(outsiderEmail, "private")).toEqual({
      state: "denied",
    });
  });

  it("says a page that was never created doesn't exist", async () => {
    expect(await statusAs(outsiderEmail, "never-created")).toEqual({
      state: "missing",
    });
    expect(await statusAs(ownerEmail, "never-created")).toEqual({
      state: "missing",
    });
  });

  it("shows trash only to people who could open the page", async () => {
    await insertDoc({ id: "trashed", trashedAt: new Date().toISOString() });
    await shareWith("trashed", viewerEmail);

    expect(await statusAs(ownerEmail, "trashed")).toEqual({
      state: "trashed",
      role: "owner",
    });
    expect(await statusAs(viewerEmail, "trashed")).toEqual({
      state: "trashed",
      role: "viewer",
    });
    expect(await statusAs(outsiderEmail, "trashed")).toEqual({
      state: "missing",
    });
  });

  it("tells a signed-out visitor nothing about whether a page exists", async () => {
    await insertDoc({ id: "private" });
    await insertDoc({ id: "trashed", trashedAt: new Date().toISOString() });

    for (const id of ["private", "trashed", "never-created"]) {
      expect(await statusAs(undefined, id)).toEqual({ state: "signed-out" });
    }
  });

  it("asks a signed-out visitor to sign in even for a public page", async () => {
    await insertDoc({ id: "public", visibility: "public" });
    await insertDoc({
      id: "public-trashed",
      visibility: "public",
      trashedAt: new Date().toISOString(),
    });

    for (const id of ["public", "public-trashed"]) {
      expect(await statusAs(undefined, id)).toEqual({ state: "signed-out" });
    }
  });

  it("doesn't call a registration's access hook for a signed-out visitor", async () => {
    const calls: Array<string | undefined> = [];
    registerShareableResource({
      type: managedType,
      resourceTable: docs,
      sharesTable: docShares,
      displayName: "QA Doc",
      getDb: () => db,
      canManageAccess: (_doc, ctx) => {
        calls.push(ctx.userEmail);
        if (!ctx.userEmail) throw new Error("401 sign in");
        return false;
      },
    });
    await insertDoc({ id: "private" });

    expect(await statusAs(undefined, "private", managedType)).toEqual({
      state: "signed-out",
    });
    expect(await statusAs(undefined, "never-created", managedType)).toEqual({
      state: "signed-out",
    });
    expect(calls).toEqual([]);
  });

  it("gives a registration's access hook the whole row", async () => {
    registerShareableResource({
      type: managedType,
      resourceTable: docs,
      sharesTable: docShares,
      displayName: "QA Doc",
      getDb: () => db,
      canManageAccess: (doc, ctx) =>
        ctx.userEmail === adminEmail && doc.title === "Secret title managed",
    });
    await insertDoc({ id: "managed" });

    expect(await statusAs(adminEmail, "managed", managedType)).toEqual({
      state: "allowed",
      role: "admin",
    });
  });

  it("treats every row as available when the registration has no rule", async () => {
    await insertDoc({ id: "trashed", trashedAt: new Date().toISOString() });

    expect(await statusAs(ownerEmail, "trashed", plainType)).toEqual({
      state: "allowed",
      role: "owner",
    });
    expect(await statusAs(outsiderEmail, "trashed", plainType)).toEqual({
      state: "denied",
    });
  });

  it("counts a row as available when its schema has no availability column", async () => {
    registerShareableResource({
      type: strictType,
      resourceTable: docs,
      sharesTable: docShares,
      displayName: "QA Doc",
      getDb: () => db,
      availability: {
        columns: ["trashedAt"],
        isAvailable: (doc) => doc.trashedAt === null,
      },
    });
    await insertDoc({ id: "older" });
    await pglite.exec("ALTER TABLE qa_status_docs DROP COLUMN trashed_at");

    expect(await statusAs(ownerEmail, "older", strictType)).toEqual({
      state: "allowed",
      role: "owner",
    });
    expect(await statusAs(outsiderEmail, "older", strictType)).toEqual({
      state: "denied",
    });
  });

  it("keeps database failures as errors instead of reading them as missing", async () => {
    await pglite.exec("DROP TABLE qa_status_docs");

    await expect(statusAs(outsiderEmail, "private")).rejects.toThrow();
  });
});

describe("get-resource-access-status", () => {
  it("is a read-only GET that signed-out visitors may call and agents can't", () => {
    expect(getResourceAccessStatus.http).toEqual({ method: "GET" });
    expect(getResourceAccessStatus.readOnly).toBe(true);
    expect(getResourceAccessStatus.requiresAuth).toBe(false);
    expect(getResourceAccessStatus.agentTool).toBe(false);
    expect(getResourceAccessStatus.mcpTool).toBe(false);
    expect(getResourceAccessStatus.toolCallable).toBe(false);
  });

  it("returns only the state and the viewer's own role", async () => {
    await insertDoc({ id: "private" });
    await insertDoc({ id: "open", visibility: "public" });

    const denied = await runWithRequestContext(
      { userEmail: outsiderEmail },
      () =>
        getResourceAccessStatus.run({ resourceType, resourceId: "private" }),
    );
    const allowed = await runWithRequestContext(
      { userEmail: outsiderEmail },
      () => getResourceAccessStatus.run({ resourceType, resourceId: "open" }),
    );

    expect(denied).toEqual({ state: "denied" });
    expect(allowed).toEqual({ state: "allowed", role: "viewer" });
    expect(JSON.stringify([denied, allowed])).not.toMatch(
      /Secret title|owner\+status|private|public/,
    );
  });
});
