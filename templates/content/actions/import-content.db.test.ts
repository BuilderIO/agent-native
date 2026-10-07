import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const writeAppStateMock = vi.hoisted(() => vi.fn(async () => undefined));
const listContentOrganizationMembershipsMock = vi.hoisted(() =>
  vi.fn(async () => [] as { orgId: string }[]),
);
const blobs = vi.hoisted(() => ({
  configured: true,
  put: vi.fn(async (input: { key?: string; data: Uint8Array }) => ({
    id: input.key ?? "blob",
    provider: "test",
    opaque: true as const,
    encrypted: false,
    size: input.data.byteLength,
  })),
  delete: vi.fn(async () => ({ deleted: true })),
}));
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal()),
  writeAppState: writeAppStateMock,
}));
vi.mock("./_content-space-access.js", async (importOriginal) => ({
  ...(await importOriginal()),
  listContentOrganizationMemberships: listContentOrganizationMembershipsMock,
}));
vi.mock("@agent-native/core/private-blob", async (importOriginal) => ({
  ...(await importOriginal()),
  isPrivateBlobConfiguredForRequest: async () => blobs.configured,
  putPrivateBlob: blobs.put,
  deletePrivateBlob: blobs.delete,
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `import-content-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "import-owner@example.com";
const GUIDE = [
  "---",
  "title: Setup guide",
  "---",
  "# Setup guide",
  "",
  "Read this first. ![Diagram](./diagram.png)",
  "",
  "- step one",
  "  - nested detail",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "See [the FAQ](./faq.md).",
  "",
].join("\n");

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let createDocument: typeof import("./create-document.js").default;
let importContent: typeof import("./import-content.js").default;
let undoContentImport: typeof import("./undo-content-import.js").default;
let listDocumentHistory: typeof import("./list-document-history.js").default;
let deleteDocumentRecursive: typeof import("./delete-document.js").deleteDocumentRecursive;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  createDocument = (await import("./create-document.js")).default;
  importContent = (await import("./import-content.js")).default;
  undoContentImport = (await import("./undo-content-import.js")).default;
  listDocumentHistory = (await import("./list-document-history.js")).default;
  ({ deleteDocumentRecursive } = await import("./delete-document.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

let parentNumber = 0;
let PARENT_ID = "";

beforeEach(async () => {
  blobs.configured = true;
  blobs.put.mockClear();
  blobs.delete.mockClear();
  writeAppStateMock.mockClear();
  PARENT_ID = `import-parent-${++parentNumber}`;
  await asOwner(() => createDocument.run({ id: PARENT_ID, title: "Imports" }));
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function asOwner<T>(run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

function guideFiles(url?: string) {
  return [
    { name: "guide.md", text: GUIDE },
    { name: "diagram.png", ...(url ? { url } : {}) },
    { name: "notes.docx" },
  ];
}

async function importedChildren() {
  return getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.parentId, PARENT_ID));
}

describe("import-content", () => {
  it("previews pages, uploads, and losses without writing", async () => {
    const preview = await asOwner(() =>
      importContent.run({
        files: guideFiles(),
        parentId: PARENT_ID,
        dryRun: true,
      }),
    );

    expect(preview.dryRun).toBe(true);
    expect(preview.storageReady).toBe(true);
    expect(preview.destination).toMatchObject({
      parentId: PARENT_ID,
      title: "Imports",
    });
    expect(preview.pages).toEqual([
      expect.objectContaining({
        id: null,
        sourceName: "guide.md",
        title: "Setup guide",
        titleSource: "frontmatter",
      }),
    ]);
    expect(preview.uploads).toEqual(["diagram.png"]);
    expect(preview.skipped).toEqual([
      { name: "notes.docx", reason: "unsupported-format", format: "docx" },
    ]);
    expect(preview.pages[0].notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "link-target-not-imported",
          samples: ["faq.md"],
        }),
      ]),
    );
    expect(await importedChildren()).toEqual([]);
    expect(blobs.put).not.toHaveBeenCalled();
  });

  it("refuses to apply before referenced images are uploaded", async () => {
    await expect(
      asOwner(() =>
        importContent.run({
          files: guideFiles(),
          parentId: PARENT_ID,
          dryRun: false,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IMPORT_IMAGE_NOT_UPLOADED" });
    expect(await importedChildren()).toEqual([]);
  });

  it("fails closed when file storage is not configured", async () => {
    blobs.configured = false;
    const preview = await asOwner(() =>
      importContent.run({
        files: guideFiles(),
        parentId: PARENT_ID,
        dryRun: true,
      }),
    );
    expect(preview.storageReady).toBe(false);
    await expect(
      asOwner(() =>
        importContent.run({
          files: guideFiles("/uploads/diagram.png"),
          parentId: PARENT_ID,
          dryRun: false,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IMPORT_STORAGE_UNAVAILABLE" });
    expect(await importedChildren()).toEqual([]);
  });

  it("reports an import with only unsupported files as not supported yet", async () => {
    await expect(
      asOwner(() =>
        importContent.run({
          files: [{ name: "deck.pptx" }],
          parentId: PARENT_ID,
          dryRun: false,
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "IMPORT_NOTHING_TO_IMPORT",
      message: expect.stringContaining("not supported yet"),
    });
  });

  it("creates a child page with provenance and an import History entry, once per key", async () => {
    const previewed = await asOwner(() =>
      importContent.run({
        files: guideFiles(),
        parentId: PARENT_ID,
        dryRun: true,
        idempotencyKey: "guide-1",
      }),
    );
    const applied = await asOwner(() =>
      importContent.run({
        files: guideFiles("/uploads/diagram.png"),
        parentId: PARENT_ID,
        dryRun: false,
        idempotencyKey: "guide-1",
      }),
    );
    expect(applied.importId).toBe(previewed.importId);
    const [page] = applied.pages;
    expect(page.id).toEqual(expect.any(String));
    expect(page.urlPath).toBe(`/page/${page.id}`);

    const children = await importedChildren();
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      id: page.id,
      title: "Setup guide",
      createdBy: OWNER,
    });
    expect(children[0].content).not.toMatch(/^#\s+Setup guide/m);
    expect(children[0].content).toContain("/uploads/diagram.png");
    expect(children[0].content).toContain("nested detail");

    const [record] = await getDb()
      .select()
      .from(schema.documentImports)
      .where(eq(schema.documentImports.documentId, page.id!));
    expect(record).toMatchObject({
      importId: applied.importId,
      sourceName: "guide.md",
      sourceFormat: "markdown",
      importedTitle: "Setup guide",
    });
    expect(record.originalBlob).not.toContain("Read this first");
    expect(blobs.put).toHaveBeenCalledTimes(1);

    const history = await asOwner(() =>
      listDocumentHistory.run({ documentId: page.id!, limit: 10 }),
    );
    expect(history.groups).toEqual([
      expect.objectContaining({
        kind: "operation",
        operation: "import-content",
        importSourceName: "guide.md",
      }),
    ]);

    const retried = await asOwner(() =>
      importContent.run({
        files: guideFiles("/uploads/diagram.png"),
        parentId: PARENT_ID,
        dryRun: false,
        idempotencyKey: "guide-1",
      }),
    );
    expect(retried.importId).toBe(applied.importId);
    expect(retried.pages.map((entry) => entry.id)).toEqual([page.id]);
    expect(await importedChildren()).toHaveLength(1);
    expect(blobs.put).toHaveBeenCalledTimes(1);

    await expect(
      asOwner(() =>
        importContent.run({
          files: [{ name: "guide.md", text: `${GUIDE}\nMore.` }],
          parentId: PARENT_ID,
          dryRun: false,
          idempotencyKey: "guide-1",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("links imported pages to each other", async () => {
    const applied = await asOwner(() =>
      importContent.run({
        files: [
          { name: "guide.md", text: "# Guide\n\nSee [the FAQ](./faq.md)." },
          { name: "faq.md", text: "# FAQ\n\nAnswers." },
        ],
        parentId: PARENT_ID,
        dryRun: false,
      }),
    );
    const faq = applied.pages.find((entry) => entry.sourceName === "faq.md")!;
    const [guide] = await getDb()
      .select()
      .from(schema.documents)
      .where(
        eq(
          schema.documents.id,
          applied.pages.find((entry) => entry.sourceName === "guide.md")!.id!,
        ),
      );
    expect(guide.content).toContain(`/page/${faq.id}`);
  });
});

describe("undo-content-import", () => {
  async function importGuide() {
    return asOwner(() =>
      importContent.run({
        files: guideFiles("/uploads/diagram.png"),
        parentId: PARENT_ID,
        dryRun: false,
      }),
    );
  }

  it("moves untouched imported pages to Trash", async () => {
    const applied = await importGuide();
    const undone = await asOwner(() =>
      undoContentImport.run({ importId: applied.importId }),
    );
    expect(undone.trashedIds).toEqual([applied.pages[0].id]);
    const [page] = await importedChildren();
    expect(page.trashedAt).toEqual(expect.any(String));

    const again = await asOwner(() =>
      undoContentImport.run({ importId: applied.importId }),
    );
    expect(again.trashedIds).toEqual([]);
  });

  it("refuses when an imported page was edited after the import", async () => {
    const applied = await importGuide();
    await getDb()
      .update(schema.documents)
      .set({ content: "Rewritten by hand." })
      .where(eq(schema.documents.id, applied.pages[0].id!));

    await expect(
      asOwner(() => undoContentImport.run({ importId: applied.importId })),
    ).rejects.toMatchObject({
      errorCode: "IMPORT_PAGE_CHANGED",
      details: { documentIds: [applied.pages[0].id] },
    });
    const [page] = await importedChildren();
    expect(page.trashedAt).toBeNull();
  });

  it("refuses a caller without access to the imported pages", async () => {
    const applied = await importGuide();
    await expect(
      runWithRequestContext({ userEmail: "someone-else@example.com" }, () =>
        undoContentImport.run({ importId: applied.importId }),
      ),
    ).rejects.toThrow();
    const [page] = await importedChildren();
    expect(page.trashedAt).toBeNull();
  });
});

describe("permanent delete", () => {
  it("removes the import record and the original file", async () => {
    const applied = await asOwner(() =>
      importContent.run({
        files: guideFiles("/uploads/diagram.png"),
        parentId: PARENT_ID,
        dryRun: false,
      }),
    );
    const id = applied.pages[0].id!;
    await deleteDocumentRecursive(getDb(), id, OWNER);

    expect(
      await getDb()
        .select()
        .from(schema.documentImports)
        .where(eq(schema.documentImports.documentId, id)),
    ).toEqual([]);
    expect(blobs.delete).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "test" }),
    );
  });
});
