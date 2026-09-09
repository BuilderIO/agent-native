import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const fixtureDirectory = resolve(
  import.meta.dirname,
  "../../../.tmp/trash-recovery-tests",
);
mkdirSync(fixtureDirectory, { recursive: true });
const dbPath = resolve(
  fixtureDirectory,
  `recovery-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "recovery-owner@example.com";
const OTHER = "recovery-other@example.com";
const TIME = "2026-09-09T12:00:00.000Z";
let db: ReturnType<typeof import("../server/db/index.js").getDb>;
let schema: typeof import("../server/db/schema.js");
let restore: typeof import("./restore-document.js").default;
let purge: typeof import("./permanently-delete-document.js").default;
let plan: typeof import("./plan-content-trash-recovery.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${dbPath}`;
  const module = await import("../server/db/index.js");
  db = module.getDb();
  schema = module.schema;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  restore = (await import("./restore-document.js")).default;
  purge = (await import("./permanently-delete-document.js")).default;
  plan = (await import("./plan-content-trash-recovery.js")).default;
}, 60_000);

afterAll(async () => {
  await closeDbExec();
  if (dirname(dbPath) !== fixtureDirectory)
    throw new Error("Unexpected fixture path");
  rmSync(dbPath, { recursive: true, force: true });
});

function asOwner<T>(run: () => Promise<T>) {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

async function page(
  id: string,
  values: Partial<typeof schema.documents.$inferInsert> = {},
) {
  await db.insert(schema.documents).values({
    id,
    title: id,
    content: `Body of ${id}`,
    ownerEmail: OWNER,
    visibility: "private",
    trashedAt: TIME,
    trashRootId: id,
    trashedBy: OWNER,
    trashOrigin: "action",
    ...values,
  });
}

async function read(id: string) {
  return (
    await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, id),
          inArray(schema.documents.ownerEmail, [OWNER, OTHER]),
        ),
      )
  )[0];
}

async function tree(prefix: string) {
  const ids = {
    parent: `${prefix}-parent`,
    child: `${prefix}-child`,
    grandchild: `${prefix}-grandchild`,
    independent: `${prefix}-independent`,
    destination: `${prefix}-destination`,
  };
  await page(ids.parent);
  await page(ids.child, {
    parentId: ids.parent,
    trashParentId: ids.parent,
    trashRootId: ids.parent,
  });
  await page(ids.grandchild, {
    parentId: ids.child,
    trashParentId: ids.child,
    trashRootId: ids.parent,
  });
  await page(ids.independent, {
    parentId: ids.parent,
    trashParentId: ids.parent,
  });
  await page(ids.destination, { trashedAt: null, trashRootId: null });
  return ids;
}

async function planFor(id: string, operation: "restore" | "purge" = "restore") {
  return asOwner(() => plan.run({ id, operation }));
}

describe("selected Trash recovery persistence", () => {
  it("restores into a shared destination without requiring access to its same-owner ancestor", async () => {
    await page("shared-ancestor", {
      ownerEmail: OTHER,
      trashedAt: null,
      trashRootId: null,
    });
    await page("shared-destination", {
      ownerEmail: OTHER,
      parentId: "shared-ancestor",
      trashedAt: null,
      trashRootId: null,
    });
    await page("shared-restore-root", { ownerEmail: OTHER });
    await db.insert(schema.documentShares).values([
      {
        id: "shared-restore-admin",
        resourceId: "shared-restore-root",
        principalType: "user",
        principalId: OWNER,
        role: "admin",
        createdBy: OTHER,
      },
      {
        id: "shared-destination-editor",
        resourceId: "shared-destination",
        principalType: "user",
        principalId: OWNER,
        role: "editor",
        createdBy: OTHER,
      },
    ]);
    await expect(
      asOwner(() => assertAccess("document", "shared-ancestor", "viewer")),
    ).rejects.toThrow();
    const ancestorBefore = await read("shared-ancestor");
    const scope = await planFor("shared-restore-root");
    await asOwner(() =>
      restore.run({
        id: "shared-restore-root",
        destinationParentId: "shared-destination",
        scopeToken: scope.scopeToken,
      }),
    );
    expect(await read("shared-restore-root")).toMatchObject({
      trashedAt: null,
      parentId: "shared-destination",
      ownerEmail: OTHER,
    });
    expect(await read("shared-ancestor")).toEqual(ancestorBefore);
  });

  it.each([
    ["owner", { ownerEmail: OTHER }],
    ["organization", { orgId: "other-ancestor-org" }],
    ["space", { spaceId: "other-ancestor-space" }],
  ] as const)(
    "rejects a destination with a different %s ancestor without mutation",
    async (kind, mismatch) => {
      const ids = await tree(`ancestor-${kind}`);
      const ancestorId = `ancestor-${kind}-outside`;
      await page(ancestorId, {
        ...mismatch,
        trashedAt: null,
        trashRootId: null,
      });
      await db
        .update(schema.documents)
        .set({ parentId: ancestorId })
        .where(
          and(
            eq(schema.documents.id, ids.destination),
            eq(schema.documents.ownerEmail, OWNER),
          ),
        );
      const selectedIds = [
        ids.child,
        ids.grandchild,
        ids.destination,
        ancestorId,
      ];
      const before = await Promise.all(selectedIds.map(read));
      const scope = await planFor(ids.child);
      await expect(
        asOwner(() =>
          restore.run({
            id: ids.child,
            destinationParentId: ids.destination,
            scopeToken: scope.scopeToken,
          }),
        ),
      ).rejects.toMatchObject({
        errorCode: "TRASH_DESTINATION_CONFLICT",
        message:
          "The destination hierarchy is unavailable. Choose another location.",
      });
      expect(await Promise.all(selectedIds.map(read))).toEqual(before);
    },
  );

  it("rejects purge confirmation when a new outside survivor appears after planning", async () => {
    await page("new-survivor-parent");
    const scope = await planFor("new-survivor-parent", "purge");
    expect(scope.detachedDocumentIds).toEqual([]);
    await page("new-survivor-child", { parentId: "new-survivor-parent" });
    await expect(
      asOwner(() =>
        purge.run({ id: "new-survivor-parent", scopeToken: scope.scopeToken }),
      ),
    ).rejects.toMatchObject({ errorCode: "TRASH_SCOPE_CONFLICT" });
    expect(await read("new-survivor-parent")).toBeDefined();
    expect(await read("new-survivor-child")).toMatchObject({
      parentId: "new-survivor-parent",
      trashRootId: "new-survivor-child",
    });
  });

  it("rejects a destination whose live ancestry returns to the selected subtree", async () => {
    const ids = await tree("cycle");
    await db
      .update(schema.documents)
      .set({ parentId: ids.grandchild })
      .where(eq(schema.documents.id, ids.destination));
    const scope = await planFor(ids.child);
    await expect(
      asOwner(() =>
        restore.run({
          id: ids.child,
          destinationParentId: ids.destination,
          scopeToken: scope.scopeToken,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "TRASH_DESTINATION_CONFLICT" });
    expect(await read(ids.child)).toMatchObject({
      parentId: ids.parent,
      trashedAt: TIME,
    });
  });

  it("does not borrow an authorized inline host grant for another Database sharing the backing Page", async () => {
    await page("duplicate-inline-host", {
      ownerEmail: OTHER,
      trashedAt: null,
      trashRootId: null,
    });
    await page("duplicate-inline-page", {
      ownerEmail: OTHER,
      visibility: "public",
      parentId: "duplicate-inline-host",
    });
    await db.insert(schema.documentShares).values({
      id: "duplicate-inline-share",
      resourceId: "duplicate-inline-host",
      principalType: "user",
      principalId: OWNER,
      role: "editor",
      createdBy: OTHER,
    });
    await db.insert(schema.contentDatabases).values([
      {
        id: "duplicate-inline-authorized",
        documentId: "duplicate-inline-page",
        ownerDocumentId: "duplicate-inline-host",
        ownerEmail: OTHER,
        deletedAt: TIME,
      },
      {
        id: "duplicate-inline-other",
        documentId: "duplicate-inline-page",
        ownerDocumentId: null,
        ownerEmail: OTHER,
        deletedAt: TIME,
      },
    ]);
    const { collectTrashRecoveryScope } =
      await import("./_trash-recovery-scope.js");
    await expect(
      asOwner(() =>
        collectTrashRecoveryScope(db, "duplicate-inline-page", "restore"),
      ),
    ).rejects.toMatchObject({ errorCode: "TRASH_ACCESS_DENIED" });
  });

  it("requires editor access before detaching an independently trashed survivor during parent purge", async () => {
    await page("survivor-parent", { ownerEmail: OTHER });
    await page("survivor-child", {
      ownerEmail: OTHER,
      parentId: "survivor-parent",
    });
    await db.insert(schema.documentShares).values({
      id: "survivor-parent-share",
      resourceId: "survivor-parent",
      principalType: "user",
      principalId: OWNER,
      role: "admin",
      createdBy: OTHER,
    });
    await expect(planFor("survivor-parent", "purge")).rejects.toMatchObject({
      errorCode: "DOCUMENT_MUTATION_ACCESS_CHANGED",
    });
    const before = await read("survivor-child");
    await expect(
      asOwner(() => purge.run({ id: "survivor-parent" })),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_MUTATION_ACCESS_CHANGED" });
    expect(await read("survivor-child")).toEqual(before);
    expect(await read("survivor-parent")).toBeDefined();
    await db.insert(schema.documentShares).values({
      id: "survivor-child-share",
      resourceId: "survivor-child",
      principalType: "user",
      principalId: OWNER,
      role: "editor",
      createdBy: OTHER,
    });
    const scope = await planFor("survivor-parent", "purge");
    expect(scope.detachedDocumentIds).toEqual(["survivor-child"]);
    await asOwner(() =>
      purge.run({ id: "survivor-parent", scopeToken: scope.scopeToken }),
    );
    expect(await read("survivor-parent")).toBeUndefined();
    expect(await read("survivor-child")).toMatchObject({
      parentId: null,
      ownerEmail: OTHER,
      trashedAt: TIME,
      trashRootId: "survivor-child",
      content: before.content,
    });
  });

  it.each(["source", "inline"] as const)(
    "does not detach a %s survivor during parent purge",
    async (kind) => {
      const parentId = `${kind}-survivor-parent`;
      const childId = `${kind}-survivor-child`;
      await page(parentId);
      await page(childId, {
        parentId,
        ...(kind === "source"
          ? { sourceMode: "local-files", sourcePath: "fixture.md" }
          : {}),
      });
      if (kind === "inline")
        await db.insert(schema.contentDatabases).values({
          id: "inline-survivor-db",
          documentId: childId,
          ownerDocumentId: parentId,
          ownerBlockId: "survivor-block",
          ownerEmail: OWNER,
          deletedAt: TIME,
        });
      const before = await read(childId);
      await expect(planFor(parentId, "purge")).rejects.toMatchObject({
        errorCode: "TRASH_SURVIVOR_DESTINATION_CONFLICT",
      });
      await expect(
        asOwner(() => purge.run({ id: parentId })),
      ).rejects.toMatchObject({
        errorCode: "TRASH_SURVIVOR_DESTINATION_CONFLICT",
      });
      expect(await read(childId)).toEqual(before);
      expect(await read(parentId)).toBeDefined();
    },
  );

  it("plans and restores a block-owned Database for its host editor and backing viewer, while denying purge", async () => {
    await page("inline-host", {
      ownerEmail: OTHER,
      trashedAt: null,
      trashRootId: null,
    });
    await page("inline-backing", {
      ownerEmail: OTHER,
      parentId: "inline-host",
      trashParentId: "inline-host",
    });
    await db.insert(schema.contentDatabases).values({
      id: "inline-database",
      documentId: "inline-backing",
      ownerDocumentId: "inline-host",
      ownerBlockId: "inline-block",
      ownerEmail: OTHER,
      deletedAt: TIME,
    });
    await db.insert(schema.documentShares).values([
      {
        id: "inline-host-share",
        resourceId: "inline-host",
        principalType: "user",
        principalId: OWNER,
        role: "editor",
        createdBy: OTHER,
      },
      {
        id: "inline-backing-share",
        resourceId: "inline-backing",
        principalType: "user",
        principalId: OWNER,
        role: "viewer",
        createdBy: OTHER,
      },
    ]);
    const { collectTrashRecoveryScope } =
      await import("./_trash-recovery-scope.js");
    const scope = await asOwner(() =>
      collectTrashRecoveryScope(db, "inline-backing", "restore"),
    );
    expect(scope.adminDocumentIds).toEqual([]);
    expect(scope.viewerDocumentIds).toEqual(["inline-backing"]);
    expect(scope.hostDocumentIds).toEqual(["inline-host"]);
    const planned = await asOwner(() =>
      plan.run({ id: "inline-backing", operation: "restore" }),
    );
    expect(planned).toMatchObject({
      requiresOriginalDestination: true,
      needsDestination: false,
      destinations: [],
    });
    await expect(planFor("inline-backing", "purge")).rejects.toMatchObject({
      errorCode: "TRASH_UNAVAILABLE",
    });
    const before = await read("inline-backing");
    await expect(
      asOwner(() =>
        restore.run({
          id: "inline-backing",
          destinationParentId: null,
          scopeToken: planned.scopeToken,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "TRASH_DESTINATION_ACCESS_DENIED" });
    expect(await read("inline-backing")).toEqual(before);
    await asOwner(() =>
      restore.run({ id: "inline-backing", scopeToken: planned.scopeToken }),
    );
    expect(await read("inline-backing")).toMatchObject({
      ownerEmail: OTHER,
      parentId: "inline-host",
      trashedAt: null,
      trashRootId: null,
      content: before.content,
    });
  });

  it("keeps block-owned viewer scope closed over ordinary descendants and refreshes host authority and bindings", async () => {
    await page("inline-guard-host", {
      ownerEmail: OTHER,
      trashedAt: null,
      trashRootId: null,
    });
    await page("inline-guard-backing", {
      ownerEmail: OTHER,
      visibility: "public",
      parentId: "inline-guard-host",
    });
    await db.insert(schema.contentDatabases).values({
      id: "inline-guard-database",
      documentId: "inline-guard-backing",
      ownerDocumentId: "inline-guard-host",
      ownerBlockId: "before-block",
      ownerEmail: OTHER,
      deletedAt: TIME,
    });
    await db.insert(schema.documentShares).values({
      id: "inline-guard-host-share",
      resourceId: "inline-guard-host",
      principalType: "user",
      principalId: OWNER,
      role: "editor",
      createdBy: OTHER,
    });
    const { collectTrashRecoveryScope } =
      await import("./_trash-recovery-scope.js");
    const before = await asOwner(() =>
      collectTrashRecoveryScope(db, "inline-guard-backing", "restore"),
    );
    expect(before.viewerDocumentIds).toEqual(["inline-guard-backing"]);
    await db
      .update(schema.contentDatabases)
      .set({ ownerBlockId: "after-block" })
      .where(eq(schema.contentDatabases.id, "inline-guard-database"));
    const after = await asOwner(() =>
      collectTrashRecoveryScope(db, "inline-guard-backing", "restore"),
    );
    expect(after.token).not.toBe(before.token);
    await db
      .update(schema.documentShares)
      .set({ role: "viewer" })
      .where(eq(schema.documentShares.id, "inline-guard-host-share"));
    await expect(
      asOwner(() =>
        collectTrashRecoveryScope(db, "inline-guard-backing", "restore"),
      ),
    ).rejects.toMatchObject({ errorCode: "TRASH_ACCESS_DENIED" });
    await db
      .update(schema.documentShares)
      .set({ role: "editor" })
      .where(eq(schema.documentShares.id, "inline-guard-host-share"));
    await page("inline-guard-private-child", {
      ownerEmail: OTHER,
      parentId: "inline-guard-backing",
      trashRootId: "inline-guard-backing",
    });
    await expect(
      asOwner(() =>
        collectTrashRecoveryScope(db, "inline-guard-backing", "restore"),
      ),
    ).rejects.toMatchObject({ errorCode: "TRASH_ACCESS_DENIED" });
  });

  it("detaches child and grandchild while preserving content and access through later parent restore", async () => {
    const ids = await tree("restore");
    await db.insert(schema.documentShares).values({
      id: "restore-share",
      resourceId: ids.child,
      principalType: "user",
      principalId: OTHER,
      role: "viewer",
      createdBy: OWNER,
    });
    await db.insert(schema.documentComments).values({
      id: "restore-comment",
      documentId: ids.child,
      threadId: "restore-thread",
      content: "Preserved comment",
      ownerEmail: OWNER,
      authorEmail: OWNER,
    });
    await page("restore-database-page", { trashedAt: null, trashRootId: null });
    await db.insert(schema.contentDatabases).values({
      id: "restore-database",
      documentId: "restore-database-page",
      ownerEmail: OWNER,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: "restore-membership",
      databaseId: "restore-database",
      documentId: ids.child,
      ownerEmail: OWNER,
      position: 0,
    });
    const before = await read(ids.child);
    const scope = await planFor(ids.child);
    expect(scope.affectedDocumentIds.sort()).toEqual(
      [ids.child, ids.grandchild].sort(),
    );
    expect(scope.needsDestination).toBe(true);
    const outcome = await asOwner(() =>
      restore.run({
        id: ids.child,
        destinationParentId: ids.destination,
        scopeToken: scope.scopeToken,
      }),
    );
    expect(outcome.affectedDocumentIds.sort()).toEqual(
      [ids.child, ids.grandchild].sort(),
    );
    const recovered = await read(ids.child);
    expect(recovered).toMatchObject({
      id: before.id,
      ownerEmail: before.ownerEmail,
      orgId: before.orgId,
      spaceId: before.spaceId,
      visibility: before.visibility,
      content: before.content,
      parentId: ids.destination,
      trashedAt: null,
      trashRootId: null,
    });
    expect(await read(ids.grandchild)).toMatchObject({
      parentId: ids.child,
      trashedAt: null,
      trashRootId: null,
    });
    expect(
      await db
        .select()
        .from(schema.documentShares)
        .where(eq(schema.documentShares.id, "restore-share")),
    ).toMatchObject([{ role: "viewer", principalId: OTHER }]);
    expect(
      await db
        .select()
        .from(schema.documentComments)
        .where(eq(schema.documentComments.id, "restore-comment")),
    ).toMatchObject([{ content: "Preserved comment" }]);
    expect(
      await db
        .select()
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.id, "restore-membership")),
    ).toMatchObject([
      { databaseId: "restore-database", documentId: ids.child },
    ]);
    const remaining = await planFor(ids.parent);
    expect(remaining.affectedDocumentIds).toEqual([ids.parent]);
    await asOwner(() =>
      restore.run({ id: ids.parent, scopeToken: remaining.scopeToken }),
    );
    expect(await read(ids.child)).toEqual(recovered);
    expect(await read(ids.independent)).toMatchObject({
      trashedAt: TIME,
      trashRootId: ids.independent,
    });
  });

  it("keeps recovered descendants intact when the remaining parent is permanently deleted", async () => {
    const ids = await tree("purge");
    const scope = await planFor(ids.child);
    await asOwner(() =>
      restore.run({
        id: ids.child,
        destinationParentId: null,
        scopeToken: scope.scopeToken,
      }),
    );
    const child = await read(ids.child);
    const grandchild = await read(ids.grandchild);
    expect(child.parentId).toBeNull();
    const remaining = await planFor(ids.parent, "purge");
    const outcome = await asOwner(() =>
      purge.run({ id: ids.parent, scopeToken: remaining.scopeToken }),
    );
    expect(outcome.affectedDocumentIds).toEqual([ids.parent]);
    expect(await read(ids.parent)).toBeUndefined();
    expect(await read(ids.child)).toEqual(child);
    expect(await read(ids.grandchild)).toEqual(grandchild);
    expect(await read(ids.independent)).toMatchObject({
      trashedAt: TIME,
      trashRootId: ids.independent,
    });
  });

  it("rejects a wrong-space destination and leaves every selected row untouched", async () => {
    const ids = await tree("destination");
    await page("wrong-space-parent", {
      spaceId: "different-space",
      trashedAt: null,
      trashRootId: null,
    });
    const before = await db
      .select()
      .from(schema.documents)
      .where(inArray(schema.documents.id, [ids.child, ids.grandchild]));
    const scope = await planFor(ids.child);
    await expect(
      asOwner(() =>
        restore.run({
          id: ids.child,
          destinationParentId: "wrong-space-parent",
          scopeToken: scope.scopeToken,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "TRASH_DESTINATION_CONFLICT" });
    expect(
      await db
        .select()
        .from(schema.documents)
        .where(inArray(schema.documents.id, [ids.child, ids.grandchild])),
    ).toEqual(before);
  });

  it("rejects stale restore and purge confirmation without partially changing the expanded group", async () => {
    const ids = await tree("stale");
    const scope = await planFor(ids.child);
    await page("stale-added", { parentId: ids.child, trashRootId: ids.parent });
    const affected = [ids.child, ids.grandchild, "stale-added"];
    const before = await db
      .select()
      .from(schema.documents)
      .where(inArray(schema.documents.id, affected));
    await expect(
      asOwner(() =>
        restore.run({
          id: ids.child,
          destinationParentId: null,
          scopeToken: scope.scopeToken,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "TRASH_SCOPE_CONFLICT" });
    await expect(
      asOwner(() => purge.run({ id: ids.child, scopeToken: scope.scopeToken })),
    ).rejects.toMatchObject({ errorCode: "TRASH_SCOPE_CONFLICT" });
    expect(
      await db
        .select()
        .from(schema.documents)
        .where(inArray(schema.documents.id, affected)),
    ).toEqual(before);
  });

  it("rejects an inaccessible descendant without changing the accessible root", async () => {
    const ids = await tree("denied");
    await db
      .update(schema.documents)
      .set({ ownerEmail: OTHER })
      .where(eq(schema.documents.id, ids.grandchild));
    const before = await read(ids.child);
    await expect(
      asOwner(() => restore.run({ id: ids.child, destinationParentId: null })),
    ).rejects.toMatchObject({ errorCode: "TRASH_ACCESS_DENIED" });
    await expect(
      asOwner(() => purge.run({ id: ids.child })),
    ).rejects.toMatchObject({ errorCode: "TRASH_ACCESS_DENIED" });
    expect(await read(ids.child)).toEqual(before);
    expect(await read(ids.grandchild)).toMatchObject({
      ownerEmail: OTHER,
      trashedAt: TIME,
    });
  });

  it("restores detached legacy members when restoring their complete deletion group", async () => {
    await page("legacy-root");
    await page("legacy-detached", {
      parentId: null,
      trashRootId: "legacy-root",
    });
    await page("legacy-independent", { parentId: "legacy-root" });
    const scope = await planFor("legacy-root");
    expect(scope.affectedDocumentIds.sort()).toEqual([
      "legacy-detached",
      "legacy-root",
    ]);
    await asOwner(() =>
      restore.run({ id: "legacy-root", scopeToken: scope.scopeToken }),
    );
    expect(await read("legacy-detached")).toMatchObject({
      parentId: null,
      trashedAt: null,
      trashRootId: null,
    });
    expect(await read("legacy-independent")).toMatchObject({
      trashedAt: TIME,
      trashRootId: "legacy-independent",
    });
  });
});
