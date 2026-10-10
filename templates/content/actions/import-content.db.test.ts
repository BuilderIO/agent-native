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
const uploads = vi.hoisted(() => ({
  count: 0,
  upload: vi.fn(async () => ({
    url: `/uploads/embedded-${++uploads.count}.png`,
    provider: "test",
  })),
  delete: vi.fn(async () => true),
}));
const flushHook = vi.hoisted(() => ({
  once: null as (() => Promise<unknown>) | null,
}));
vi.mock("./_document-flush.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./_document-flush.js")>();
  return {
    ...original,
    flushOpenDocumentEditorToSql: async (
      ...args: Parameters<typeof original.flushOpenDocumentEditorToSql>
    ) => {
      const hook = flushHook.once;
      flushHook.once = null;
      await hook?.();
      return original.flushOpenDocumentEditorToSql(...args);
    },
  };
});
vi.mock("@agent-native/core/file-upload", async (importOriginal) => ({
  ...(await importOriginal()),
  getActiveFileUploadProviderForRequest: async () => ({ id: "test" }),
  uploadFile: uploads.upload,
  deleteUploadedFile: uploads.delete,
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
let personalContentSpaceId: typeof import("./_content-spaces.js").personalContentSpaceId;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  createDocument = (await import("./create-document.js")).default;
  importContent = (await import("./import-content.js")).default;
  undoContentImport = (await import("./undo-content-import.js")).default;
  listDocumentHistory = (await import("./list-document-history.js")).default;
  ({ deleteDocumentRecursive } = await import("./delete-document.js"));
  ({ personalContentSpaceId } = await import("./_content-spaces.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

let parentNumber = 0;
let PARENT_ID = "";

beforeEach(async () => {
  blobs.configured = true;
  blobs.put.mockReset();
  blobs.put.mockImplementation(storedBlob);
  blobs.delete.mockClear();
  uploads.upload.mockClear();
  uploads.delete.mockClear();
  writeAppStateMock.mockClear();
  flushHook.once = null;
  PARENT_ID = `import-parent-${++parentNumber}`;
  await asOwner(() => createDocument.run({ id: PARENT_ID, title: "Imports" }));
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function storedBlob(input: { key?: string; data: Uint8Array }) {
  return {
    id: input.key ?? "blob",
    provider: "test",
    opaque: true as const,
    encrypted: false,
    size: input.data.byteLength,
  };
}

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

  it("refuses a page that grows past what a page can hold once its image urls are filled in", async () => {
    const files = [
      { name: "small.md", text: "# Small\n\nHello." },
      {
        name: "gallery.md",
        text: `# Gallery\n\n${"![D](./diagram.png)\n\n".repeat(130)}`,
      },
      { name: "diagram.png", url: `/uploads/${"d".repeat(4000)}.png` },
    ];
    const preview = await asOwner(() =>
      importContent.run({ files, parentId: PARENT_ID, dryRun: true }),
    );
    expect(preview.pages.map((page) => page.sourceName)).toEqual([
      "small.md",
      "gallery.md",
    ]);

    await expect(
      asOwner(() =>
        importContent.run({ files, parentId: PARENT_ID, dryRun: false }),
      ),
    ).rejects.toMatchObject({ errorCode: "IMPORT_PAGE_TOO_LARGE" });
    expect(await importedChildren()).toEqual([]);
    expect(blobs.put).not.toHaveBeenCalled();
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

  it("skips images that share a name instead of guessing which one a page means", async () => {
    const preview = await asOwner(() =>
      importContent.run({
        files: [
          { name: "guide.md", text: "# Guide\n\n![Logo](images/logo.png)" },
          { name: "logo.png", url: "/uploads/first-logo.png" },
          { name: "logo.png", url: "/uploads/second-logo.png" },
        ],
        parentId: PARENT_ID,
        dryRun: true,
      }),
    );
    expect(preview.pages[0].notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "asset-missing" }),
      ]),
    );
    expect(preview.uploads).toEqual([]);
    expect(preview.skipped).toEqual([
      { name: "logo.png", reason: "duplicate-name", format: "png" },
      { name: "logo.png", reason: "duplicate-name", format: "png" },
    ]);
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
      requestSha256: expect.any(String),
      importedStateSha256: expect.any(String),
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
    await expect(
      asOwner(() =>
        importContent.run({
          files: guideFiles("/uploads/diagram-replaced.png"),
          parentId: PARENT_ID,
          dryRun: false,
          idempotencyKey: "guide-1",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });

    const otherParent = `${PARENT_ID}-other`;
    await asOwner(() =>
      createDocument.run({ id: otherParent, title: "Elsewhere" }),
    );
    await expect(
      asOwner(() =>
        importContent.run({
          files: guideFiles("/uploads/diagram.png"),
          parentId: otherParent,
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

  it("previews a top-level import without creating the caller's workspaces", async () => {
    const newcomer = "first-import@example.com";
    const preview = await runWithRequestContext({ userEmail: newcomer }, () =>
      importContent.run({
        files: [{ name: "notes.md", text: "# Notes\n\nHello." }],
        dryRun: true,
      }),
    );
    expect(preview.destination.spaceId).toBe(personalContentSpaceId(newcomer));
    expect(
      await getDb()
        .select()
        .from(schema.contentSpaces)
        .where(eq(schema.contentSpaces.id, personalContentSpaceId(newcomer))),
    ).toEqual([]);
  });

  it("creates a page once when two applies with one key race", async () => {
    const apply = () =>
      asOwner(() =>
        importContent.run({
          files: guideFiles("/uploads/diagram.png"),
          parentId: PARENT_ID,
          dryRun: false,
          idempotencyKey: "race-1",
        }),
      );
    const [first, second] = await Promise.all([apply(), apply()]);
    expect(second.pages.map((page) => page.id)).toEqual(
      first.pages.map((page) => page.id),
    );
    expect(await importedChildren()).toHaveLength(1);
    const records = await getDb()
      .select()
      .from(schema.documentImports)
      .where(eq(schema.documentImports.importId, first.importId));
    expect(records).toHaveLength(1);
    const history = await asOwner(() =>
      listDocumentHistory.run({ documentId: first.pages[0].id!, limit: 10 }),
    );
    expect(history.groups).toHaveLength(1);
    // The losing attempt's original is removed; the recorded one is kept.
    expect(blobs.put).toHaveBeenCalledTimes(2);
    expect(blobs.delete).toHaveBeenCalledTimes(1);
    expect(blobs.delete).not.toHaveBeenCalledWith(
      JSON.parse(records[0].originalBlob),
    );
  });

  it("deletes the embedded image a losing retry uploaded, and keeps the page's", async () => {
    const apply = () =>
      asOwner(() =>
        importContent.run({
          files: [
            {
              name: "chart.md",
              text: "# Chart\n\n![Chart](data:image/png;base64,AAAA)",
            },
          ],
          parentId: PARENT_ID,
          dryRun: false,
          idempotencyKey: "race-embedded",
        }),
      );
    await Promise.all([apply(), apply()]);
    const [page] = await importedChildren();
    expect(uploads.upload).toHaveBeenCalledTimes(2);
    expect(uploads.delete).toHaveBeenCalledTimes(1);
    const [[, deleted]] = uploads.delete.mock.calls as unknown as [
      [string, { url: string }],
    ];
    expect(page.content).toMatch(/\/uploads\/embedded-\d\.png/);
    expect(page.content).not.toContain(deleted.url);
  });

  it("keeps a created page and its embedded image when a step after the page saves fails", async () => {
    writeAppStateMock.mockRejectedValueOnce(new Error("refresh failed"));
    const applied = await asOwner(() =>
      importContent.run({
        files: [
          {
            name: "chart.md",
            text: "# Chart\n\n![Chart](data:image/png;base64,AAAA)",
          },
        ],
        parentId: PARENT_ID,
        dryRun: false,
      }),
    );
    const [page] = await importedChildren();
    expect(applied.pages.map((entry) => entry.id)).toEqual([page.id]);
    expect(page.content).toMatch(/\/uploads\/embedded-\d+\.png/);
    expect(uploads.upload).toHaveBeenCalledTimes(1);
    expect(uploads.delete).not.toHaveBeenCalled();
  });

  it("keeps the embedded image of a page that may have saved when it can't look the page up", async () => {
    writeAppStateMock.mockImplementationOnce(async () => {
      vi.spyOn(getDb(), "select").mockImplementationOnce(() => {
        const lookup = {
          from: () => lookup,
          leftJoin: () => lookup,
          where: () => Promise.reject(new Error("connection reset")),
        };
        return lookup as never;
      });
      throw new Error("refresh failed");
    });
    const stopped = await asOwner(() =>
      importContent.run({
        files: [
          {
            name: "chart.md",
            text: "# Chart\n\n![Chart](data:image/png;base64,AAAA)",
          },
        ],
        parentId: PARENT_ID,
        dryRun: false,
      }),
    ).catch((error: unknown) => error);
    expect(stopped).toMatchObject({ errorCode: "IMPORT_INCOMPLETE" });
    const [page] = await importedChildren();
    expect(page.content).toMatch(/\/uploads\/embedded-\d+\.png/);
    expect(uploads.delete).not.toHaveBeenCalled();
    expect(blobs.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["percent-encoded", "data:image/png,%89PNG%0D%0A%1A%0A"],
    ["base64 with a percent escape", "data:image/png;base64,iVBORw0KGgo%3D"],
  ])("uploads the bytes a %s embedded image spells", async (_, url) => {
    await asOwner(() =>
      importContent.run({
        files: [{ name: "logo.md", text: `# Logo\n\n![Logo](${url})` }],
        parentId: PARENT_ID,
        dryRun: false,
      }),
    );
    const [[uploaded]] = uploads.upload.mock.calls as unknown as [
      [{ data: Uint8Array }],
    ];
    expect([...uploaded.data]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const [page] = await importedChildren();
    expect(page.content).toMatch(/\/uploads\/embedded-\d+\.png/);
  });

  it("binds a key to one set of files when two applies with different files race", async () => {
    const apply = (name: string) =>
      asOwner(() =>
        importContent.run({
          files: [{ name, text: `# ${name}\n\nBody.` }],
          parentId: PARENT_ID,
          dryRun: false,
          idempotencyKey: "race-2",
        }),
      );
    const results = await Promise.allSettled([apply("a.md"), apply("b.md")]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { errorCode: "IDEMPOTENCY_KEY_REUSED" } });
    expect(await importedChildren()).toHaveLength(1);
  });

  it("names the pages it created when an import stops partway, and finishes on retry", async () => {
    const files = [
      { name: "a.md", text: "# A\n\nFirst." },
      { name: "b.md", text: "# B\n\nSecond." },
    ];
    blobs.put.mockImplementationOnce(storedBlob);
    blobs.put.mockImplementationOnce(async () => null as never);
    const stopped = await asOwner(() =>
      importContent.run({
        files,
        parentId: PARENT_ID,
        dryRun: false,
        idempotencyKey: "partial-1",
      }),
    ).catch((error: unknown) => error);
    expect(stopped).toMatchObject({
      errorCode: "IMPORT_INCOMPLETE",
      message: expect.stringContaining("Imported 1 of 2 pages"),
      details: {
        importId: expect.any(String),
        documentIds: [expect.any(String)],
        cause: "IMPORT_STORAGE_UNAVAILABLE",
      },
    });
    expect(await importedChildren()).toHaveLength(1);
    const { details } = stopped as {
      details: { importId: string; documentIds: string[] };
    };

    const finished = await asOwner(() =>
      importContent.run({
        files,
        parentId: PARENT_ID,
        dryRun: false,
        idempotencyKey: "partial-1",
      }),
    );
    expect(finished.importId).toBe(details.importId);
    expect(finished.pages.map((page) => page.id)).toContain(
      details.documentIds[0],
    );
    expect(await importedChildren()).toHaveLength(2);
  });

  it("reports an unexpected stop without its raw message, even when the page lookup fails", async () => {
    const files = [
      { name: "a.md", text: "# A\n\nFirst." },
      { name: "b.md", text: "# B\n\nSecond." },
    ];
    blobs.put.mockImplementationOnce(storedBlob);
    blobs.put.mockImplementationOnce(async () => {
      vi.spyOn(getDb(), "select").mockImplementationOnce(() => {
        throw new Error("connection reset");
      });
      throw new Error("insert failed with params: PRIVATE-BODY-TEXT");
    });
    const stopped = await asOwner(() =>
      importContent.run({
        files,
        parentId: PARENT_ID,
        dryRun: false,
        idempotencyKey: "partial-2",
      }),
    ).catch((error: unknown) => error);
    expect(stopped).toMatchObject({
      errorCode: "IMPORT_INCOMPLETE",
      details: {
        documentIds: [expect.any(String)],
        documentIdsComplete: false,
        cause: "unexpected",
      },
    });
    expect((stopped as Error).message).not.toContain("PRIVATE-BODY-TEXT");
    expect(await importedChildren()).toHaveLength(1);
  });

  it("reports an unexpected failure before any page lands without its raw message", async () => {
    blobs.put.mockImplementationOnce(async () => {
      throw new Error("insert failed with params: PRIVATE-BODY-TEXT");
    });
    const failed = await asOwner(() =>
      importContent.run({
        files: [{ name: "a.md", text: "# A\n\nFirst." }],
        parentId: PARENT_ID,
        dryRun: false,
      }),
    ).catch((error: unknown) => error);
    expect((failed as Error).message).toBe(
      "The server hit an unexpected error before any page was imported.",
    );
    expect(await importedChildren()).toHaveLength(0);
  });

  it("keeps raw frontmatter values out of the import record", async () => {
    const applied = await asOwner(() =>
      importContent.run({
        files: [
          {
            name: "embedded.md",
            text: "---\nattachment: data:image/png;base64,UklTS1lQQVlMT0FE\n---\n# Embedded\n\nBody.",
          },
          {
            name: "scalar.md",
            text: "---\ndata:image/png;base64,U0NBTEFSUEFZTE9BRA\n---\n# Scalar\n\nBody.",
          },
        ],
        parentId: PARENT_ID,
        dryRun: false,
      }),
    );
    const records = await getDb()
      .select()
      .from(schema.documentImports)
      .where(eq(schema.documentImports.importId, applied.importId));
    expect(records).toHaveLength(2);
    expect(JSON.stringify(records)).not.toContain("UklTS1lQQVlMT0FE");
    expect(JSON.stringify(records)).not.toContain("U0NBTEFSUEFZTE9BRA");
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

  it("refuses to retry an undone import instead of reporting its pages imported", async () => {
    const apply = () =>
      asOwner(() =>
        importContent.run({
          files: guideFiles("/uploads/diagram.png"),
          parentId: PARENT_ID,
          dryRun: false,
          idempotencyKey: "undone-1",
        }),
      );
    const applied = await apply();
    await asOwner(() => undoContentImport.run({ importId: applied.importId }));

    await expect(apply()).rejects.toMatchObject({
      errorCode: "IMPORT_PAGE_TRASHED",
    });
    const [page] = await importedChildren();
    expect(page.trashedAt).toEqual(expect.any(String));
  });

  it("stops an import whose pages are undone while it runs", async () => {
    const apply = (dryRun: boolean) =>
      asOwner(() =>
        importContent.run({
          files: [
            { name: "a.md", text: "# A\n\nFirst." },
            { name: "b.md", text: "# B\n\nSecond." },
          ],
          parentId: PARENT_ID,
          dryRun,
          idempotencyKey: "undone-midway",
        }),
      );
    const { importId } = await apply(true);
    blobs.put.mockImplementationOnce(storedBlob);
    blobs.put.mockImplementationOnce(async (input) => {
      await undoContentImport.run({ importId });
      return storedBlob(input);
    });

    await expect(apply(false)).rejects.toMatchObject({
      errorCode: "IMPORT_PAGE_TRASHED",
    });
    const children = await importedChildren();
    expect(children).toHaveLength(1);
    expect(children[0].trashedAt).toEqual(expect.any(String));
  });

  it("refuses a racing apply whose page was undone while it uploaded", async () => {
    const apply = () =>
      asOwner(() =>
        importContent.run({
          files: guideFiles("/uploads/diagram.png"),
          parentId: PARENT_ID,
          dryRun: false,
          idempotencyKey: "race-undone",
        }),
      );
    blobs.put.mockImplementationOnce(async (input) => {
      const applied = await apply();
      await undoContentImport.run({ importId: applied.importId });
      return storedBlob(input);
    });

    await expect(apply()).rejects.toMatchObject({
      errorCode: "IMPORT_PAGE_TRASHED",
    });
    const children = await importedChildren();
    expect(children).toHaveLength(1);
    expect(children[0].trashedAt).toEqual(expect.any(String));
  });

  it("refuses a racing apply once another page from the import is in Trash", async () => {
    const apply = () =>
      asOwner(() =>
        importContent.run({
          files: [
            { name: "a.md", text: "# A\n\nFirst." },
            { name: "b.md", text: "# B\n\nSecond." },
          ],
          parentId: PARENT_ID,
          dryRun: false,
          idempotencyKey: "race-trashed-sibling",
        }),
      );
    let applied: Awaited<ReturnType<typeof apply>> | undefined;
    // The racing apply uploads a.md's original, the other apply runs whole,
    // then a.md's page goes to Trash while the racing apply uploads b.md's.
    blobs.put.mockImplementationOnce(async (input) => {
      applied = await apply();
      return storedBlob(input);
    });
    blobs.put.mockImplementationOnce(storedBlob);
    blobs.put.mockImplementationOnce(storedBlob);
    blobs.put.mockImplementationOnce(async (input) => {
      const page = applied!.pages.find((entry) => entry.sourceName === "a.md");
      await getDb()
        .update(schema.documents)
        .set({ trashedAt: new Date().toISOString() })
        .where(eq(schema.documents.id, page!.id!));
      return storedBlob(input);
    });

    await expect(apply()).rejects.toMatchObject({
      errorCode: "IMPORT_PAGE_TRASHED",
    });
  });

  it("refuses while the import is still adding pages", async () => {
    const apply = () =>
      asOwner(() =>
        importContent.run({
          files: [
            { name: "a.md", text: "# A\n\nFirst." },
            { name: "b.md", text: "# B\n\nSecond." },
          ],
          parentId: PARENT_ID,
          dryRun: false,
          idempotencyKey: "in-progress-1",
        }),
      );
    blobs.put.mockImplementationOnce(storedBlob);
    blobs.put.mockImplementationOnce(async () => null as never);
    const stopped = await apply().catch((error: unknown) => error);
    const { importId } = (stopped as { details: { importId: string } }).details;
    // The import's second page lands after Undo read which pages it made.
    flushHook.once = apply;

    await expect(
      asOwner(() => undoContentImport.run({ importId })),
    ).rejects.toMatchObject({ errorCode: "IMPORT_IN_PROGRESS" });
    const children = await importedChildren();
    expect(children).toHaveLength(2);
    expect(children.map((page) => page.trashedAt)).toEqual([null, null]);
  });

  it("moves an imported page to Trash after someone else became its owner", async () => {
    const applied = await importGuide();
    const id = applied.pages[0].id!;
    const newOwner = "new-owner@example.com";
    await getDb()
      .update(schema.documents)
      .set({ ownerEmail: newOwner })
      .where(eq(schema.documents.id, id));
    await getDb().insert(schema.documentShares).values({
      id: crypto.randomUUID(),
      resourceId: id,
      principalType: "user",
      principalId: OWNER,
      role: "editor",
      createdBy: newOwner,
      createdAt: new Date().toISOString(),
    });

    const undone = await asOwner(() =>
      undoContentImport.run({ importId: applied.importId }),
    );
    expect(undone.trashedIds).toEqual([id]);
    const [page] = await importedChildren();
    expect(page.trashedAt).toEqual(expect.any(String));
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

  it("refuses when an imported page was moved, re-described, or given a child page", async () => {
    const described = await importGuide();
    await getDb()
      .update(schema.documents)
      .set({ description: "Added later." })
      .where(eq(schema.documents.id, described.pages[0].id!));
    await expect(
      asOwner(() => undoContentImport.run({ importId: described.importId })),
    ).rejects.toMatchObject({ errorCode: "IMPORT_PAGE_CHANGED" });

    const moved = await importGuide();
    await getDb()
      .update(schema.documents)
      .set({ parentId: null })
      .where(eq(schema.documents.id, moved.pages[0].id!));
    await expect(
      asOwner(() => undoContentImport.run({ importId: moved.importId })),
    ).rejects.toMatchObject({ errorCode: "IMPORT_PAGE_CHANGED" });

    const nested = await importGuide();
    const child = await asOwner(() =>
      createDocument.run({
        title: "My own notes",
        parentId: nested.pages[0].id!,
      }),
    );
    await expect(
      asOwner(() => undoContentImport.run({ importId: nested.importId })),
    ).rejects.toMatchObject({
      errorCode: "IMPORT_PAGE_CHANGED",
      details: { documentIds: [nested.pages[0].id] },
    });
    const [kept] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, child.id));
    expect(kept.trashedAt).toBeNull();
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
