import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withMigrationRuntime } from "@agent-native/core/db";
import { serializeIconValue } from "@agent-native/core/icons";
import {
  runFrameworkReleaseMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const checkOwner = vi.hoisted(() => vi.fn());
vi.mock("./private-icon-authority.js", () => ({
  assertPrivateIconOwner: checkOwner,
  // As in the real module, owning is the check passing; any other failure
  // still throws.
  ownsPrivateIcon: async (input: unknown) => {
    try {
      await checkOwner(input);
      return true;
    } catch (error) {
      if (
        (error as Error).message !== "Private icon is unavailable to this user."
      )
        throw error;
      return false;
    }
  },
}));
vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-private-icons-${process.pid}-${Date.now()}.pglite`,
);
const ASSET = "11111111-1111-4111-8111-111111111111";
const FORGED = "22222222-2222-4222-8222-222222222222";
const OWNER = "icon-owner@example.test";
const SHARED = "icon-shared@example.test";
const OTHER = "icon-other@example.test";

let db: ReturnType<typeof import("../db/index.js").getDb>;
let schema: typeof import("../db/schema.js");
let refs: typeof import("./private-icon-references.js");
let resolveEditablePrivateIconOrgId: typeof import("./private-icon-target.js").resolveEditablePrivateIconOrgId;
let updateDocumentAction: typeof import("../../actions/update-document.js").default;
let duplicateDatabaseItemAction: typeof import("../../actions/duplicate-database-item.js").default;
let duplicateDatabaseItemsAction: typeof import("../../actions/duplicate-database-items.js").default;
let restoreDocumentVersionAction: typeof import("../../actions/restore-document-version.js").default;
let count = 0;

function icon(id = ASSET) {
  return serializeIconValue({
    version: 1,
    kind: "image",
    authority: "private-icon",
    assetId: id,
  })!;
}

async function document(
  options: {
    visibility?: "private" | "public";
    icon?: string | null;
    content?: string;
    spaceId?: string;
    parentId?: string;
  } = {},
) {
  const id = `private-icon-doc-${process.pid}-${++count}`;
  await db.insert(schema.documents).values({
    id,
    ownerEmail: OWNER,
    orgId: null,
    spaceId: options.spaceId,
    parentId: options.parentId,
    title: "Icon test",
    content: options.content ?? "",
    icon: options.icon ?? null,
    visibility: options.visibility ?? "private",
  });
  return id;
}

async function share(documentId: string) {
  await db.insert(schema.documentShares).values({
    id: `private-icon-share-${process.pid}-${++count}`,
    resourceId: documentId,
    principalType: "user",
    principalId: SHARED,
    role: "viewer",
    createdBy: OWNER,
  });
}

async function collectionWithIconRows(rowCount: number) {
  const spaceId = `private-icon-space-${process.pid}-${++count}`;
  const filesDocumentId = await document({ spaceId });
  const filesDatabaseId = `private-icon-files-${process.pid}-${++count}`;
  await db.insert(schema.contentDatabases).values({
    id: filesDatabaseId,
    spaceId,
    systemRole: "files",
    ownerEmail: OWNER,
    documentId: filesDocumentId,
    title: "Files",
  });
  await db.insert(schema.contentSpaces).values({
    id: spaceId,
    name: "Icons",
    kind: "personal",
    ownerEmail: OWNER,
    filesDatabaseId,
    createdBy: OWNER,
  });
  const collectionDocumentId = await document({ spaceId });
  const databaseId = `private-icon-db-${process.pid}-${++count}`;
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    spaceId,
    ownerEmail: OWNER,
    documentId: collectionDocumentId,
    title: "Icons",
  });
  await db.insert(schema.documentShares).values({
    id: `private-icon-share-${process.pid}-${++count}`,
    resourceId: collectionDocumentId,
    principalType: "user",
    principalId: SHARED,
    role: "editor",
    createdBy: OWNER,
  });
  const sourceContent = `<callout icon="${icon().replace(/"/g, "&quot;")}">\n\tShared\n</callout>`;
  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    const documentId = await document({
      icon: icon(),
      content: sourceContent,
      spaceId,
      parentId: collectionDocumentId,
    });
    const itemId = `private-icon-item-${process.pid}-${++count}`;
    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      databaseId,
      documentId,
      ownerEmail: OWNER,
      position: index,
    });
    await share(documentId);
    await refs.syncPrivateIconReference(db, {
      elementType: "document",
      elementId: documentId,
      documentId,
      icon: icon(),
      ownerEmail: OWNER,
      orgId: null,
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      refs.syncPrivateCalloutReferences(db, {
        documentId,
        before: "",
        after: sourceContent,
        userEmail: OWNER,
        ownerEmail: OWNER,
        orgId: null,
      }),
    );
    rows.push({ itemId, documentId });
  }
  return { databaseId, sourceContent, rows };
}

beforeAll(async () => {
  const targetUrl =
    process.env.CONTENT_BLOCK_ACTION_POSTGRES_URL ?? `pglite:${TEST_DB_PATH}`;
  if (targetUrl.startsWith("postgres")) {
    const target = new URL(targetUrl);
    if (!target.pathname.includes("test"))
      throw new Error("Private icon tests require an isolated test database.");
    console.info("DB target before connect", {
      env: "CONTENT_BLOCK_ACTION_POSTGRES_URL",
      host: target.hostname,
      port: target.port,
      database: target.pathname,
      credentials: "[redacted]",
    });
  }
  process.env.DATABASE_URL = targetUrl;
  if (targetUrl.startsWith("postgres"))
    await withMigrationRuntime(() => runFrameworkReleaseMigrations(undefined));
  const module = await import("../db/index.js");
  db = module.getDb();
  schema = module.schema;
  refs = await import("./private-icon-references.js");
  resolveEditablePrivateIconOrgId = (await import("./private-icon-target.js"))
    .resolveEditablePrivateIconOrgId;
  updateDocumentAction = (await import("../../actions/update-document.js"))
    .default;
  duplicateDatabaseItemAction = (
    await import("../../actions/duplicate-database-item.js")
  ).default;
  duplicateDatabaseItemsAction = (
    await import("../../actions/duplicate-database-items.js")
  ).default;
  restoreDocumentVersionAction = (
    await import("../../actions/restore-document-version.js")
  ).default;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  checkOwner.mockImplementation(
    async ({
      assetId,
      ownerEmail,
    }: {
      assetId: string;
      ownerEmail: string;
    }) => {
      if (assetId !== ASSET || ownerEmail !== OWNER)
        throw new Error("Private icon is unavailable to this user.");
    },
  );
}, 60_000);

afterAll(() => rmSync(TEST_DB_PATH, { recursive: true, force: true }));

describe("private icon references", () => {
  it("rechecks private icon authority after a workspace move before the save locks the page", async () => {
    const id = await document();
    const previousCheck = checkOwner.getMockImplementation();
    checkOwner.mockImplementation(
      async ({ orgId }: { orgId: string | null }) => {
        if (orgId !== null)
          throw new Error("Private icon is unavailable to this user.");
        await db
          .update(schema.documents)
          .set({ orgId: "moved-icon-workspace" })
          .where(eq(schema.documents.id, id));
      },
    );
    try {
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            { id, icon: icon() },
            { caller: "frontend", userEmail: OWNER },
          ),
        ),
      ).rejects.toThrow("Private icon is unavailable");
      const [current] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      expect(current).toMatchObject({
        orgId: "moved-icon-workspace",
        icon: null,
      });
      const references = await db
        .select()
        .from(schema.privateIconReferences)
        .where(eq(schema.privateIconReferences.documentId, id));
      expect(references).toHaveLength(0);
      expect(checkOwner).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: "moved-icon-workspace" }),
      );
    } finally {
      checkOwner.mockReset();
      if (previousCheck) checkOwner.mockImplementation(previousCheck);
    }
  });

  it("uses the editable document's personal scope despite an active workspace session", async () => {
    const id = await document();
    await share(id);
    await expect(
      runWithRequestContext(
        { userEmail: OWNER, orgId: "active-workspace" },
        () => resolveEditablePrivateIconOrgId(id),
      ),
    ).resolves.toBeNull();
    await expect(
      runWithRequestContext(
        { userEmail: SHARED, orgId: "active-workspace" },
        () => resolveEditablePrivateIconOrgId(id),
      ),
    ).rejects.toThrow(/editor role/iu);
  });

  it("serves a live icon to its document owner and explicit viewer, but denies an outsider", async () => {
    const id = await document({ icon: icon() });
    await share(id);
    await refs.syncPrivateIconReference(db, {
      elementType: "document",
      elementId: id,
      documentId: id,
      icon: icon(),
      ownerEmail: OWNER,
      orgId: null,
    });
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: OWNER }),
    ).resolves.toEqual({ orgId: null });
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: SHARED }),
    ).resolves.toEqual({ orgId: null });
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: OTHER }),
    ).resolves.toBeNull();
    await db
      .update(schema.documents)
      .set({ icon: null })
      .where(eq(schema.documents.id, id));
  });

  it("serves an icon on an actual public document without a session", async () => {
    const id = await document({ visibility: "public", icon: icon(FORGED) });
    await refs.syncPrivateIconReference(db, {
      elementType: "document",
      elementId: id,
      documentId: id,
      icon: icon(FORGED),
      ownerEmail: OWNER,
      orgId: null,
    });
    await expect(refs.resolveReadablePrivateIcon(FORGED, {})).resolves.toEqual({
      orgId: null,
    });
    await db
      .update(schema.documents)
      .set({ icon: null })
      .where(eq(schema.documents.id, id));
    await expect(
      refs.resolveReadablePrivateIcon(FORGED, {}),
    ).resolves.toBeNull();
  });

  it("rejects a forged assignment and preserves access through the remaining live reference", async () => {
    await expect(
      refs.verifyPrivateIconAssignment({
        icon: icon(FORGED),
        userEmail: OWNER,
        orgId: null,
      }),
    ).rejects.toThrow("unavailable");
    const first = await document({ icon: icon() });
    const second = await document({ icon: icon() });
    await share(second);
    for (const id of [first, second]) {
      await refs.syncPrivateIconReference(db, {
        elementType: "document",
        elementId: id,
        documentId: id,
        icon: icon(),
        ownerEmail: OWNER,
        orgId: null,
      });
    }
    await db
      .update(schema.documents)
      .set({ icon: null })
      .where(eq(schema.documents.id, first));
    await refs.syncPrivateIconReference(db, {
      elementType: "document",
      elementId: first,
      documentId: first,
      icon: null,
      ownerEmail: OWNER,
      orgId: null,
    });
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: SHARED }),
    ).resolves.toEqual({ orgId: null });
    await db
      .update(schema.documents)
      .set({ icon: null })
      .where(eq(schema.documents.id, second));
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: SHARED }),
    ).resolves.toBeNull();
  });

  it("rejects forged private IDs in the document action before creating a reference", async () => {
    const id = await document();
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id, icon: icon(FORGED) }),
      ),
    ).rejects.toThrow("unavailable");
    const [stored] = await db
      .select({ icon: schema.documents.icon })
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    expect(stored.icon).toBeNull();
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id, icon: icon(ASSET) }),
    );
    await expect(
      refs.resolveReadablePrivateIcon(ASSET, { userEmail: OWNER }),
    ).resolves.toEqual({ orgId: null });
  });

  it("copies only a live source icon and callout that the collaborator can view", async () => {
    const sourceContent = `<callout icon="${icon().replace(/"/g, "&quot;")}">\n\tShared\n</callout>`;
    const sourceId = await document({ icon: icon(), content: sourceContent });
    await share(sourceId);
    await refs.syncPrivateIconReference(db, {
      elementType: "document",
      elementId: sourceId,
      documentId: sourceId,
      icon: icon(),
      ownerEmail: OWNER,
      orgId: null,
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      refs.syncPrivateCalloutReferences(db, {
        documentId: sourceId,
        before: "",
        after: sourceContent,
        userEmail: OWNER,
        ownerEmail: OWNER,
        orgId: null,
      }),
    );
    const copyId = await document({ icon: icon(), content: sourceContent });
    checkOwner.mockClear();
    await runWithRequestContext({ userEmail: SHARED }, async () => {
      await refs.verifyPrivateIconCopiedFromDocument(db, {
        sourceDocumentId: sourceId,
        icon: icon(),
        ownerEmail: OWNER,
        orgId: null,
      });
      await refs.syncPrivateCalloutReferences(db, {
        documentId: copyId,
        before: "",
        after: sourceContent,
        userEmail: SHARED,
        ownerEmail: OWNER,
        orgId: null,
        source: { kind: "document", documentId: sourceId },
      });
    });
    expect(checkOwner).not.toHaveBeenCalled();
    const copied = await db
      .select()
      .from(schema.privateIconReferences)
      .where(eq(schema.privateIconReferences.elementId, `${copyId}:${ASSET}`));
    expect(copied).toHaveLength(1);

    await db
      .delete(schema.privateIconReferences)
      .where(eq(schema.privateIconReferences.elementId, sourceId));
    await expect(
      runWithRequestContext({ userEmail: SHARED }, () =>
        refs.verifyPrivateIconCopiedFromDocument(db, {
          sourceDocumentId: sourceId,
          icon: icon(),
          ownerEmail: OWNER,
          orgId: null,
        }),
      ),
    ).rejects.toThrow("unavailable");
    await db
      .delete(schema.privateIconReferences)
      .where(
        eq(schema.privateIconReferences.elementId, `${sourceId}:${ASSET}`),
      );
    await expect(
      runWithRequestContext({ userEmail: SHARED }, () =>
        refs.syncPrivateCalloutReferences(db, {
          documentId: copyId,
          before: "",
          after: sourceContent,
          userEmail: SHARED,
          ownerEmail: OWNER,
          orgId: null,
          source: { kind: "document", documentId: sourceId },
        }),
      ),
    ).rejects.toThrow("unavailable");
    await expect(
      runWithRequestContext({ userEmail: OTHER }, () =>
        refs.syncPrivateCalloutReferences(db, {
          documentId: copyId,
          before: "",
          after: sourceContent,
          userEmail: OTHER,
          ownerEmail: OWNER,
          orgId: null,
          source: { kind: "document", documentId: sourceId },
        }),
      ),
    ).rejects.toThrow();
  });

  it("restores a saved callout reference without granting arbitrary image assignment", async () => {
    const savedContent = `<callout icon="${icon().replace(/"/g, "&quot;")}">\n\tSaved\n</callout>`;
    const id = await document({ content: "Current" });
    const versionId = `private-icon-version-${process.pid}-${++count}`;
    await db.insert(schema.documentVersions).values({
      id: versionId,
      documentId: id,
      ownerEmail: OWNER,
      title: "Saved",
      content: savedContent,
    });
    await db.insert(schema.documentShares).values({
      id: `private-icon-share-${process.pid}-${++count}`,
      resourceId: id,
      principalType: "user",
      principalId: SHARED,
      role: "editor",
      createdBy: OWNER,
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      refs.registerPrivateCalloutIcon({
        documentId: id,
        assetId: ASSET,
        userEmail: OWNER,
        ownerEmail: OWNER,
        orgId: null,
      }),
    );
    checkOwner.mockClear();
    await runWithRequestContext({ userEmail: SHARED }, () =>
      refs.syncPrivateCalloutReferences(db, {
        documentId: id,
        before: "Current",
        after: savedContent,
        userEmail: SHARED,
        ownerEmail: OWNER,
        orgId: null,
        source: { kind: "version", versionId },
      }),
    );
    expect(checkOwner).not.toHaveBeenCalled();
    await expect(
      runWithRequestContext({ userEmail: SHARED }, () =>
        refs.syncPrivateCalloutReferences(db, {
          documentId: id,
          before: "Current",
          after: savedContent.replace(ASSET, FORGED),
          userEmail: SHARED,
          ownerEmail: OWNER,
          orgId: null,
          source: { kind: "version", versionId },
        }),
      ),
    ).rejects.toThrow("unavailable");
    await expect(
      runWithRequestContext({ userEmail: SHARED }, () =>
        refs.syncPrivateCalloutReferences(db, {
          documentId: id,
          before: "Current",
          after: savedContent.replace(ASSET, FORGED),
          userEmail: SHARED,
          ownerEmail: OWNER,
          orgId: null,
        }),
      ),
    ).rejects.toThrow("unavailable");
  });

  it("duplicates a collaborator-visible row with its page and callout image references", async () => {
    const { rows, sourceContent } = await collectionWithIconRows(1);
    checkOwner.mockClear();
    const result = await runWithRequestContext({ userEmail: SHARED }, () =>
      duplicateDatabaseItemAction.run({ itemId: rows[0].itemId }),
    );
    const copyId = result.duplicatedDocumentId;
    const [copy] = await db
      .select({
        icon: schema.documents.icon,
        content: schema.documents.content,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, copyId));
    expect(copy).toEqual({ icon: icon(), content: sourceContent });
    const copiedReferences = await db
      .select({ elementType: schema.privateIconReferences.elementType })
      .from(schema.privateIconReferences)
      .where(eq(schema.privateIconReferences.documentId, copyId));
    expect(
      copiedReferences.map((reference) => reference.elementType).sort(),
    ).toEqual(["callout", "callout-authorization-v1", "document"]);
    expect(checkOwner).not.toHaveBeenCalled();
  });

  it("duplicates a collaborator-visible batch with each row's private icons", async () => {
    const { databaseId, rows } = await collectionWithIconRows(2);
    checkOwner.mockClear();
    const result = await runWithRequestContext({ userEmail: SHARED }, () =>
      duplicateDatabaseItemsAction.run({
        databaseId,
        itemIds: rows.map((row) => row.itemId),
      }),
    );
    expect(result.duplicatedDocumentIds).toHaveLength(2);
    for (const documentId of result.duplicatedDocumentIds ?? []) {
      const copiedReferences = await db
        .select({ elementType: schema.privateIconReferences.elementType })
        .from(schema.privateIconReferences)
        .where(eq(schema.privateIconReferences.documentId, documentId));
      expect(
        copiedReferences.map((reference) => reference.elementType).sort(),
      ).toEqual(["callout", "callout-authorization-v1", "document"]);
    }
    expect(checkOwner).not.toHaveBeenCalled();
  });

  it("rejects duplication when the source icon no longer matches its authorized reference", async () => {
    const { rows } = await collectionWithIconRows(1);
    await db
      .update(schema.documents)
      .set({ icon: icon(FORGED) })
      .where(eq(schema.documents.id, rows[0].documentId));
    await expect(
      runWithRequestContext({ userEmail: SHARED }, () =>
        duplicateDatabaseItemAction.run({ itemId: rows[0].itemId }),
      ),
    ).rejects.toThrow("unavailable");
  });

  it("restores a collaborator-visible saved version containing a prior callout image", async () => {
    const savedContent = `<callout icon="${icon().replace(/"/g, "&quot;")}">\n\tSaved\n</callout>`;
    const id = await document({ content: "Current" });
    await db.insert(schema.documentShares).values({
      id: `private-icon-share-${process.pid}-${++count}`,
      resourceId: id,
      principalType: "user",
      principalId: SHARED,
      role: "editor",
      createdBy: OWNER,
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id, content: savedContent }, undefined),
    );
    await runWithRequestContext({ userEmail: SHARED }, () =>
      updateDocumentAction.run({ id, content: "Current" }, undefined),
    );
    const versions = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, id));
    const versionId = versions.find(
      (version) => version.content === savedContent,
    )!.id;
    const [before] = await db
      .select({ updatedAt: schema.documents.updatedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    checkOwner.mockClear();
    await runWithRequestContext({ userEmail: SHARED }, () =>
      restoreDocumentVersionAction.run({
        documentId: id,
        versionId,
        expectedUpdatedAt: before.updatedAt,
      }),
    );
    const [restored] = await db
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    expect(restored.content).toBe(savedContent);
    const [reference] = await db
      .select({ assetId: schema.privateIconReferences.assetId })
      .from(schema.privateIconReferences)
      .where(eq(schema.privateIconReferences.elementId, `${id}:${ASSET}`));
    expect(reference.assetId).toBe(ASSET);
    expect(checkOwner).not.toHaveBeenCalled();
  });

  describe("body writer authorization", () => {
    async function rowFixture() {
      const create = (await import("../../actions/create-content-database.js"))
        .default;
      const get = (await import("../../actions/get-content-database.js"))
        .default;
      const add = (await import("../../actions/add-database-item.js")).default;
      const list = (
        await import("../../actions/list-content-database-blocks.js")
      ).default;
      const created = await runWithRequestContext({ userEmail: OWNER }, () =>
        create.run({ title: "Icon boundary" }),
      );
      const databaseId = created.database.id;
      const current = await runWithRequestContext({ userEmail: OWNER }, () =>
        get.run({ databaseId }),
      );
      if (!("database" in current) || !current.mutationContract)
        throw new Error("Missing mutation contract.");
      const contract = current.mutationContract;
      const property = contract.properties.find(
        (value) => value.type === "blocks",
      )!;
      const row = await runWithRequestContext({ userEmail: OWNER }, () =>
        add.run({
          target: contract.target,
          expectedSchemaRevision: contract.schemaRevision,
          idempotencyKey: crypto.randomUUID(),
          title: "Icon row",
        }),
      );
      const documentId = row.receipt.row.documentId;
      const target = {
        ...contract.target,
        itemId: row.receipt.row.itemId,
        rowDocumentId: documentId,
        propertyId: property.id,
      };
      const listed = await runWithRequestContext({ userEmail: OWNER }, () =>
        list.run({ target, limit: 100 }),
      );
      return {
        databaseId,
        documentId,
        target,
        listed,
        databaseDocumentId: created.database.documentId,
      };
    }

    async function state(documentId: string, databaseId: string) {
      return {
        pages: await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId)),
        versions: await db
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, documentId)),
        references: await db
          .select()
          .from(schema.privateIconReferences)
          .where(eq(schema.privateIconReferences.documentId, documentId)),
        blocks: await db
          .select()
          .from(schema.documentBlocks)
          .innerJoin(
            schema.documentBlockFields,
            eq(schema.documentBlocks.fieldId, schema.documentBlockFields.id),
          )
          .where(eq(schema.documentBlockFields.documentId, documentId)),
        receipts: await db
          .select()
          .from(schema.contentDatabaseRowMutationReceipts)
          .where(
            eq(
              schema.contentDatabaseRowMutationReceipts.databaseId,
              databaseId,
            ),
          ),
      };
    }

    it.each(["block", "property", "legacy-edit", "migration"] as const)(
      "rejects an unchecked %s body before it can pollute normal history",
      async (writer) => {
        const f = await rowFixture();
        const body = `<callout icon="${icon(FORGED).replace(/"/g, "&quot;")}">\n\tForged\n</callout>`;
        const before = await state(f.documentId, f.databaseId);
        const write = async () => {
          if (writer === "block") {
            const action = (
              await import("../../actions/mutate-content-database-block.js")
            ).default;
            return action.run({
              target: f.target,
              expectedSchemaRevision: f.listed.schemaRevision,
              expectedRowRevision: f.listed.rowRevision,
              expectedFieldRevision: f.listed.fieldRevision,
              idempotencyKey: crypto.randomUUID(),
              operation: "insert",
              block: { kind: "notionCallout", nfm: body },
              position: { placement: "end" },
            });
          }
          if (writer === "property") {
            const action = (
              await import("../../actions/set-document-property.js")
            ).default;
            return action.run({
              documentId: f.documentId,
              databaseId: f.databaseId,
              propertyId: f.target.propertyId,
              value: body,
              expectedBlocksFieldRevision: f.listed.fieldRevision,
            });
          }
          if (writer === "legacy-edit") {
            const action = (await import("../../actions/edit-document.js"))
              .default;
            return action.run(
              { id: f.documentId, edits: [{ find: "Clean", replace: body }] },
              { caller: "frontend", userEmail: OWNER },
            );
          }
          const [page] = before.pages;
          const action = (
            await import("../../actions/migrate-content-database-rows.js")
          ).default;
          return action.run({
            phase: "apply",
            plan: {
              databaseId: f.databaseId,
              databaseDocumentId: f.databaseDocumentId,
              idempotencyKey: crypto.randomUUID(),
              expectedRowCount: 1,
              legacyPropertyIds: [],
              propertyDefinitions: [],
              rows: [
                {
                  itemId: f.target.itemId,
                  documentId: f.documentId,
                  expectedUpdatedAt: page.updatedAt,
                  content: body,
                  propertyValues: [],
                  protectedPropertyValues: [],
                },
              ],
            },
          });
        };
        if (writer === "legacy-edit") {
          await db
            .update(schema.documents)
            .set({ content: "Clean" })
            .where(eq(schema.documents.id, f.documentId));
          before.pages[0].content = "Clean";
        }
        await expect(
          runWithRequestContext({ userEmail: OWNER }, write),
        ).rejects.toMatchObject({
          errorCode: "PRIVATE_ICON_UNAVAILABLE",
          details: { assetIds: [FORGED] },
        });
        expect(await state(f.documentId, f.databaseId)).toEqual(before);
      },
    );

    it("rejects a form body atomically without creating a row or icon proof", async () => {
      const f = await rowFixture();
      await db
        .update(schema.contentDatabases)
        .set({
          viewConfigJson: JSON.stringify({
            activeViewId: "icon-form",
            views: [
              {
                id: "icon-form",
                type: "form",
                name: "Icon form",
                formQuestions: [
                  { key: "name", enabled: true, required: true },
                  { key: f.target.propertyId, enabled: true, required: true },
                ],
              },
            ],
          }),
        })
        .where(eq(schema.contentDatabases.id, f.databaseId));
      const pages = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.parentId, f.databaseDocumentId));
      const action = (
        await import("../../actions/submit-content-database-form.js")
      ).default;
      const body = `<callout icon="${icon(FORGED).replace(/"/g, "&quot;")}">\n\tForm text\n</callout>`;
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          action.run({
            databaseId: f.databaseId,
            viewId: "icon-form",
            title: "Forged form",
            propertyValues: { [f.target.propertyId]: body },
          }),
        ),
      ).rejects.toMatchObject({ errorCode: "PRIVATE_ICON_UNAVAILABLE" });
      expect(
        await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.parentId, f.databaseDocumentId)),
      ).toEqual(pages);
    });
  });

  describe("restoring a body History kept instead of saving", () => {
    function callout(assetId: string, text: string) {
      return `<callout icon="${icon(assetId).replace(/"/g, "&quot;")}">\n\t${text}\n</callout>`;
    }

    async function editablePage(content = "Current") {
      const id = await document({ content });
      await db.insert(schema.documentShares).values({
        id: `private-icon-share-${process.pid}-${++count}`,
        resourceId: id,
        principalType: "user",
        principalId: SHARED,
        role: "editor",
        createdBy: OWNER,
      });
      return id;
    }

    async function keptBody(
      documentId: string,
      content: string,
      authorEmail: string,
    ) {
      const versionId = `private-icon-recovery-${process.pid}-${++count}`;
      await db.insert(schema.documentVersions).values({
        id: versionId,
        documentId,
        ownerEmail: OWNER,
        title: "Icon test",
        content,
        actorEmail: authorEmail,
        operation: "update-document-displaced",
        checkpointKind: "recovery",
      });
      return versionId;
    }

    async function restore(
      userEmail: string,
      documentId: string,
      versionId: string,
    ) {
      const [current] = await db
        .select({ updatedAt: schema.documents.updatedAt })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId));
      return runWithRequestContext({ userEmail }, () =>
        restoreDocumentVersionAction.run({
          documentId,
          versionId,
          expectedUpdatedAt: current.updatedAt,
        }),
      );
    }

    async function pageState(documentId: string) {
      const [page] = await db
        .select({ content: schema.documents.content })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId));
      const references = await db
        .select({ assetId: schema.privateIconReferences.assetId })
        .from(schema.privateIconReferences)
        .where(eq(schema.privateIconReferences.documentId, documentId));
      return {
        content: page.content,
        references: [
          ...new Set(references.map((reference) => reference.assetId)),
        ],
      };
    }

    it("refuses to bring back an icon that neither the restorer nor the author of a save History kept can use, and names it", async () => {
      const id = await editablePage();
      const body = callout(FORGED, "Kept typing");
      const kept = await runWithRequestContext({ userEmail: SHARED }, () =>
        updateDocumentAction.run(
          {
            id,
            content: body,
            browserSaveAttemptId: crypto.randomUUID(),
            editorSessionId: `tab:${id}`,
            editorEditGeneration: 1,
            editorSnapshotTitle: "Icon test",
            editorSnapshotContent: body,
            reuseLabels: [],
          },
          { caller: "frontend", userEmail: SHARED },
        ),
      );
      expect(kept).toMatchObject({
        preservationRequired: true,
        checkpointId: expect.any(String),
      });
      expect(await pageState(id)).toEqual({
        content: "Current",
        references: [],
      });

      await expect(
        restore(SHARED, id, (kept as { checkpointId: string }).checkpointId),
      ).rejects.toMatchObject({
        errorCode: "PRIVATE_ICON_AUTHORIZATION_UNPROVEN",
        statusCode: 403,
        details: { assetIds: [FORGED] },
      });
      expect(await pageState(id)).toEqual({
        content: "Current",
        references: [],
      });
      await expect(
        refs.resolveReadablePrivateIcon(FORGED, { userEmail: SHARED }),
      ).resolves.toBeNull();
    });

    it("brings back an icon the author of the kept body owns", async () => {
      const id = await editablePage();
      const body = callout(ASSET, "Kept typing");
      const versionId = await keptBody(id, body, OWNER);

      await restore(SHARED, id, versionId);

      expect(await pageState(id)).toEqual({
        content: body,
        references: [ASSET],
      });
    });

    it("refuses polluted normal and recovery checkpoints without altering stored text or history", async () => {
      const id = await editablePage();
      const body = callout(FORGED, "Legacy recovery text");
      const normalId = `private-icon-version-${process.pid}-${++count}`;
      await db.insert(schema.documentVersions).values({
        id: normalId,
        documentId: id,
        ownerEmail: OWNER,
        title: "Icon test",
        content: body,
        checkpointKind: "before",
        actorEmail: OWNER,
      });
      const recoveryId = await keptBody(id, body, SHARED);
      const snapshot = async () => ({
        pages: await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, id)),
        versions: await db
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
        references: await db
          .select()
          .from(schema.privateIconReferences)
          .where(eq(schema.privateIconReferences.documentId, id)),
        blocks: await db
          .select()
          .from(schema.documentBlocks)
          .innerJoin(
            schema.documentBlockFields,
            eq(schema.documentBlocks.fieldId, schema.documentBlockFields.id),
          )
          .where(eq(schema.documentBlockFields.documentId, id)),
      });
      const before = await snapshot();
      for (const versionId of [normalId, recoveryId]) {
        await expect(restore(SHARED, id, versionId)).rejects.toMatchObject({
          errorCode: "PRIVATE_ICON_AUTHORIZATION_UNPROVEN",
          statusCode: 403,
          details: { assetIds: [FORGED] },
        });
        expect(await snapshot()).toEqual(before);
        expect(
          await refs.resolveReadablePrivateIcon(FORGED, { userEmail: SHARED }),
        ).toBeNull();
      }
    });

    it("recovers escaped icon JSON from durable owner proof after removal", async () => {
      const id = await editablePage();
      const encoded = icon().replace(
        ASSET,
        ASSET.split("1").join(String.fromCharCode(92) + "u0031"),
      );
      const body = `<callout icon="${encoded.split('"').join("&quot;")}">\n\tEscaped owner text\n</callout>`;
      expect(body.includes(ASSET)).toBe(false);
      expect([...refs.calloutPrivateIconAssetIds(body)]).toEqual([ASSET]);
      await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id, content: body }, undefined),
      );
      await runWithRequestContext({ userEmail: SHARED }, () =>
        updateDocumentAction.run({ id, content: "Current" }, undefined),
      );
      const evidence = await db
        .select()
        .from(schema.privateIconReferences)
        .where(eq(schema.privateIconReferences.documentId, id));
      expect(evidence.map((row) => row.elementType)).toEqual([
        "callout-authorization-v1",
      ]);
      const versionId = await keptBody(id, body, SHARED);
      checkOwner.mockClear();
      await restore(SHARED, id, versionId);
      expect(checkOwner).not.toHaveBeenCalled();
      expect((await pageState(id)).content).toBe(body);
    });

    it("lets an icon owner reauthorize an unproved checkpoint before an editor restores", async () => {
      const id = await editablePage();
      const body = callout(ASSET, "Legacy owner text");
      const versionId = await keptBody(id, body, SHARED);
      await expect(restore(SHARED, id, versionId)).rejects.toMatchObject({
        errorCode: "PRIVATE_ICON_AUTHORIZATION_UNPROVEN",
      });
      const register = (
        await import("../../actions/register-private-callout-icon.js")
      ).default;
      await runWithRequestContext({ userEmail: OWNER }, () =>
        register.run({ documentId: id, assetId: ASSET }),
      );
      await restore(SHARED, id, versionId);
      expect((await pageState(id)).content).toBe(body);
    });

    it("rolls back all grants and history when the last of several icons is unproved", async () => {
      const id = await editablePage();
      const versionId = await keptBody(
        id,
        callout(ASSET, "Authorized") + "\n\n" + callout(FORGED, "Unproved"),
        OWNER,
      );
      const pages = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      const versions = await db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id));
      await expect(restore(SHARED, id, versionId)).rejects.toMatchObject({
        errorCode: "PRIVATE_ICON_AUTHORIZATION_UNPROVEN",
        details: { assetIds: [FORGED] },
      });
      expect(
        await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, id)),
      ).toEqual(pages);
      expect(
        await db
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
      ).toEqual(versions);
      expect(
        await db
          .select()
          .from(schema.privateIconReferences)
          .where(eq(schema.privateIconReferences.documentId, id)),
      ).toEqual([]);
    });

    it("reports an exhausted authorization budget distinctly and preserves the checkpoint", async () => {
      const id = await editablePage();
      const ids = Array.from(
        { length: 65 },
        (_, i) =>
          `${(i + 1).toString(16).padStart(8, "0")}-3333-4333-8333-333333333333`,
      );
      const body = ids.map((id) => callout(id, "Budget")).join("\n\n");
      const versionId = await keptBody(id, body, SHARED);
      checkOwner.mockClear();
      await expect(restore(SHARED, id, versionId)).rejects.toMatchObject({
        errorCode: "PRIVATE_ICON_AUTHORIZATION_INCOMPLETE",
        statusCode: 409,
        details: { reason: "asset_budget", limit: 64 },
      });
      expect(checkOwner).not.toHaveBeenCalled();
      expect((await pageState(id)).content).toBe("Current");
      const [kept] = await db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, versionId));
      expect(kept.content).toBe(body);
    });

    it("propagates authority outages without converting them into missing authorization", async () => {
      const id = await editablePage();
      const versionId = await keptBody(id, callout(ASSET, "Outage"), SHARED);
      checkOwner.mockRejectedValueOnce(new Error("Icon authority offline"));
      await expect(restore(SHARED, id, versionId)).rejects.toThrow(
        "Icon authority offline",
      );
      expect(await pageState(id)).toEqual({
        content: "Current",
        references: [],
      });
    });

    it("keeps proof-only icons unreadable and refuses to carry proof across a scope change", async () => {
      const id = await editablePage();
      const viewer = `proof-viewer-${++count}@example.test`;
      await db
        .insert(schema.documentShares)
        .values({
          id: crypto.randomUUID(),
          resourceId: id,
          principalType: "user",
          principalId: viewer,
          role: "editor",
          createdBy: OWNER,
        });
      await runWithRequestContext({ userEmail: OWNER }, () =>
        refs.registerPrivateCalloutIcon({
          documentId: id,
          assetId: ASSET,
          userEmail: OWNER,
          ownerEmail: OWNER,
          orgId: null,
        }),
      );
      expect(
        await refs.resolveReadablePrivateIcon(ASSET, { userEmail: viewer }),
      ).toBeNull();
      const versionId = await keptBody(id, callout(ASSET, "Scoped"), SHARED);
      await db
        .update(schema.documents)
        .set({ orgId: "moved-icon-test-org" })
        .where(eq(schema.documents.id, id));
      await expect(restore(SHARED, id, versionId)).rejects.toMatchObject({
        errorCode: "PRIVATE_ICON_AUTHORIZATION_UNPROVEN",
      });
      expect(
        await refs.resolveReadablePrivateIcon(ASSET, { userEmail: viewer }),
      ).toBeNull();
    });

    it("brings back text whose icon is already on the page without checking it", async () => {
      const onPage = callout(FORGED, "Current");
      const id = await editablePage(onPage);
      await db.insert(schema.privateIconReferences).values({
        elementType: "callout",
        elementId: `${id}:${FORGED}`,
        documentId: id,
        assetId: FORGED,
        ownerEmail: OWNER,
        orgId: null,
      });
      const body = `${onPage}\n\nKept typing`;
      const versionId = await keptBody(id, body, SHARED);
      checkOwner.mockClear();

      await restore(SHARED, id, versionId);

      expect((await pageState(id)).content).toBe(body);
      expect(checkOwner).not.toHaveBeenCalled();
    });
  });

  it("requires a real saved callout, ignoring a code-fenced lookalike", async () => {
    const stored = icon(FORGED).replace(/"/g, "&quot;");
    const id = await document({
      visibility: "public",
      content: `\`\`\`md\n<callout icon="${stored}">\n\tFake\n</callout>\n\`\`\``,
    });
    await db.insert(schema.privateIconReferences).values({
      elementType: "callout",
      elementId: `${id}:${FORGED}`,
      documentId: id,
      assetId: FORGED,
      ownerEmail: OWNER,
      orgId: null,
    });
    await expect(
      refs.resolveReadablePrivateIcon(FORGED, {}),
    ).resolves.toBeNull();
    await db
      .update(schema.documents)
      .set({ content: `<callout icon="${stored}">\n\tReal\n</callout>` })
      .where(eq(schema.documents.id, id));
    await expect(refs.resolveReadablePrivateIcon(FORGED, {})).resolves.toEqual({
      orgId: null,
    });
  });

  it("propagates unavailable ownership authority on assignment", async () => {
    checkOwner.mockRejectedValueOnce(
      new Error("Private icon authority unavailable"),
    );
    await expect(
      refs.verifyPrivateIconAssignment({
        icon: icon(),
        userEmail: OWNER,
        orgId: null,
      }),
    ).rejects.toThrow("authority unavailable");
  });
});
