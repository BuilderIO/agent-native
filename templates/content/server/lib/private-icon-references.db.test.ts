import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeIconValue } from "@agent-native/core/icons";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { H3 } from "h3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const checkOwner = vi.hoisted(() => vi.fn());
const ownsIcon = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ email: "" }));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getSession: async () => ({ email: session.email }),
}));
vi.mock("./private-icon-authority.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./private-icon-authority.js")>()),
  assertPrivateIconOwner: checkOwner,
  ownsPrivateIcon: ownsIcon,
  readPrivateIcon: async () => ({
    data: new Uint8Array([1, 2, 3]),
    mimeType: "image/png",
  }),
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
let readIcon: H3["request"];
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
  const iconRoute = (await import("../routes/api/private-icons/[id].get.js"))
    .default;
  const iconApp = new H3();
  iconApp.get("/icons/:id", iconRoute);
  readIcon = iconApp.request.bind(iconApp);
  ownsIcon.mockImplementation(
    async ({ assetId, ownerEmail }: { assetId: string; ownerEmail: string }) =>
      (assetId === ASSET && ownerEmail === OWNER) ||
      (assetId === FORGED && ownerEmail === OTHER),
  );
  checkOwner.mockImplementation(
    async ({
      assetId,
      ownerEmail,
    }: {
      assetId: string;
      ownerEmail: string;
    }) => {
      if (
        !(
          (assetId === ASSET && ownerEmail === OWNER) ||
          (assetId === FORGED && ownerEmail === OTHER)
        )
      )
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

  it("keeps unproved saved callouts without granting arbitrary image assignment", async () => {
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
    expect(
      await db
        .select()
        .from(schema.privateIconReferences)
        .where(eq(schema.privateIconReferences.documentId, id)),
    ).toEqual([]);
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

  it("restores a collaborator-visible version's text without authorizing its prior image", async () => {
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
    expect(reference).toBeUndefined();
    expect(checkOwner).not.toHaveBeenCalled();
  });

  it.each(["recovery", "after"] as const)(
    "restores %s text verbatim without publishing a non-owned icon, including on later saves",
    async (checkpointKind) => {
      const saved = `Keep $60 and snake_case verbatim.\n\n<callout icon="${icon(FORGED).replace(/"/g, "&quot;")}">\n\tPrivate\n</callout>\n\n`;
      const id = await document({ content: "Current" });
      await db.insert(schema.documentVersions).values({
        id: `unproved-${id}`,
        documentId: id,
        ownerEmail: OWNER,
        title: "Recovered",
        content: saved,
        checkpointKind,
        actorEmail: OTHER,
      });
      await db.insert(schema.documentShares).values({
        id: `editor-${id}`,
        resourceId: id,
        principalType: "user",
        principalId: SHARED,
        role: "editor",
        createdBy: OWNER,
      });
      const [before] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      assert(before);
      ownsIcon.mockClear();
      await runWithRequestContext({ userEmail: SHARED }, () =>
        restoreDocumentVersionAction.run({
          documentId: id,
          versionId: `unproved-${id}`,
          expectedUpdatedAt: before.updatedAt,
        }),
      );
      const [restored] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      assert(restored);
      expect(restored.content).toBe(saved);
      expect(
        await db
          .select()
          .from(schema.privateIconReferences)
          .where(eq(schema.privateIconReferences.documentId, id)),
      ).toEqual([]);
      expect(ownsIcon).toHaveBeenCalledExactlyOnceWith({
        assetId: FORGED,
        ownerEmail: SHARED,
        orgId: null,
      });

      session.email = OTHER;
      expect(
        (await readIcon(new Request(`http://localhost/icons/${FORGED}`)))
          .status,
      ).toBe(200);
      for (const viewer of [OWNER, SHARED]) {
        session.email = viewer;
        expect(
          (await readIcon(new Request(`http://localhost/icons/${FORGED}`)))
            .status,
        ).toBe(404);
      }

      ownsIcon.mockClear();
      checkOwner.mockClear();
      await runWithRequestContext({ userEmail: SHARED }, () =>
        updateDocumentAction.run({ id, content: `${saved}Later text.` }),
      );
      expect(ownsIcon).not.toHaveBeenCalled();
      expect(checkOwner).not.toHaveBeenCalled();
      const [later] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      assert(later);
      expect(later.content).toBe(`${saved}Later text.`);
      expect(
        await refs.resolveReadablePrivateIcon(FORGED, { userEmail: SHARED }),
      ).toBeNull();

      await db.insert(schema.documentShares).values({
        id: `icon-owner-${id}`,
        resourceId: id,
        principalType: "user",
        principalId: OTHER,
        role: "editor",
        createdBy: OWNER,
      });
      const register = (
        await import("../../actions/register-private-callout-icon.js")
      ).default;
      await runWithRequestContext({ userEmail: OTHER }, () =>
        register.run({ documentId: id, assetId: FORGED }),
      );
      session.email = SHARED;
      expect(
        (await readIcon(new Request(`http://localhost/icons/${FORGED}`)))
          .status,
      ).toBe(200);
      await db
        .update(schema.documents)
        .set({ content: "Finished" })
        .where(eq(schema.documents.id, id));
    },
  );

  it.each(["restorer owns icon", "existing page reference"] as const)(
    "restores an authorized callout: %s",
    async (authorization) => {
      const saved = `<callout icon="${icon().replace(/"/g, "&quot;")}">\n\tSaved\n</callout>`;
      const id = await document({ content: "Current" });
      await share(id);
      await db.insert(schema.documentVersions).values({
        id: `authorized-${id}`,
        documentId: id,
        ownerEmail: OWNER,
        title: "Recovered",
        content: saved,
      });
      if (authorization === "existing page reference") {
        await refs.registerPrivateCalloutIcon({
          documentId: id,
          assetId: ASSET,
          userEmail: OWNER,
          ownerEmail: OWNER,
          orgId: null,
        });
        await db
          .update(schema.documentShares)
          .set({ role: "editor" })
          .where(eq(schema.documentShares.resourceId, id));
      }
      const userEmail = authorization === "restorer owns icon" ? OWNER : SHARED;
      const [before] = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      assert(before);
      await runWithRequestContext({ userEmail }, () =>
        restoreDocumentVersionAction.run({
          documentId: id,
          versionId: `authorized-${id}`,
          expectedUpdatedAt: before.updatedAt,
        }),
      );
      expect(
        await db
          .select({ assetId: schema.privateIconReferences.assetId })
          .from(schema.privateIconReferences)
          .where(eq(schema.privateIconReferences.documentId, id)),
      ).toEqual([{ assetId: ASSET }]);
      expect(
        await refs.resolveReadablePrivateIcon(ASSET, { userEmail: SHARED }),
      ).toEqual({ orgId: null });
    },
  );

  it("rolls back a restore when icon ownership cannot be checked", async () => {
    const saved = `<callout icon="${icon().replace(/"/g, "&quot;")}">\n\tSaved\n</callout>`;
    const id = await document({ content: "Current" });
    await db.insert(schema.documentVersions).values({
      id: `unavailable-${id}`,
      documentId: id,
      ownerEmail: OWNER,
      title: "Recovered",
      content: saved,
    });
    const [before] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    assert(before);
    ownsIcon.mockRejectedValueOnce(
      new Error("Private icon authority unavailable"),
    );
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        restoreDocumentVersionAction.run({
          documentId: id,
          versionId: `unavailable-${id}`,
          expectedUpdatedAt: before.updatedAt,
        }),
      ),
    ).rejects.toThrow("authority unavailable");
    const [current] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    assert(current);
    expect(current.content).toBe("Current");
    expect(current.updatedAt).toBe(before.updatedAt);
    expect(
      await db
        .select()
        .from(schema.privateIconReferences)
        .where(eq(schema.privateIconReferences.documentId, id)),
    ).toEqual([]);
  });

  it("saves text on a page with more than 64 unchanged private icons", async () => {
    const saved = Array.from({ length: 65 }, (_, index) => {
      const assetId = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
      return `<callout icon="${icon(assetId).replace(/"/g, "&quot;")}">\n\t${index}\n</callout>`;
    }).join("\n\n");
    const id = await document({ content: saved });
    checkOwner.mockClear();
    ownsIcon.mockClear();
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id, content: `${saved}\n\nMore text.` }),
    );
    const [current] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    assert(current);
    expect(current.content).toBe(`${saved}\n\nMore text.`);
    expect(checkOwner).not.toHaveBeenCalled();
    expect(ownsIcon).not.toHaveBeenCalled();
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
