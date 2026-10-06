import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeIconValue } from "@agent-native/core/icons";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const checkOwner = vi.hoisted(() => vi.fn());
vi.mock("./private-icon-authority.js", () => ({
  assertPrivateIconOwner: checkOwner,
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
  const id = `private-icon-doc-${++count}`;
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
    id: `private-icon-share-${++count}`,
    resourceId: documentId,
    principalType: "user",
    principalId: SHARED,
    role: "viewer",
    createdBy: OWNER,
  });
}

async function collectionWithIconRows(rowCount: number) {
  const spaceId = `private-icon-space-${++count}`;
  const filesDocumentId = await document({ spaceId });
  const filesDatabaseId = `private-icon-files-${++count}`;
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
  const databaseId = `private-icon-db-${++count}`;
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    spaceId,
    ownerEmail: OWNER,
    documentId: collectionDocumentId,
    title: "Icons",
  });
  await db.insert(schema.documentShares).values({
    id: `private-icon-share-${++count}`,
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
    const itemId = `private-icon-item-${++count}`;
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
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
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
    const versionId = `private-icon-version-${++count}`;
    await db.insert(schema.documentVersions).values({
      id: versionId,
      documentId: id,
      ownerEmail: OWNER,
      title: "Saved",
      content: savedContent,
    });
    await db.insert(schema.documentShares).values({
      id: `private-icon-share-${++count}`,
      resourceId: id,
      principalType: "user",
      principalId: SHARED,
      role: "editor",
      createdBy: OWNER,
    });
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
          after: savedContent,
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
    ).toEqual(["callout", "document"]);
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
      ).toEqual(["callout", "document"]);
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
    const versionId = `private-icon-version-${++count}`;
    await db.insert(schema.documentVersions).values({
      id: versionId,
      documentId: id,
      ownerEmail: OWNER,
      title: "Saved",
      content: savedContent,
    });
    await db.insert(schema.documentShares).values({
      id: `private-icon-share-${++count}`,
      resourceId: id,
      principalType: "user",
      principalId: SHARED,
      role: "editor",
      createdBy: OWNER,
    });
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
