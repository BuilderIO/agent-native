import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  parsePptx: vi.fn(),
  uploadPptxSlideImages: vi.fn(),
  assertAccess: vi.fn(async () => undefined),
  notifyClients: vi.fn(),
  writeAppState: vi.fn(),
  withSlideAssetReferencesLocked: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: {
    decks: {
      id: "decks.id",
      data: "decks.data",
      title: "decks.title",
      designSystemId: "decks.designSystemId",
      ownerEmail: "decks.ownerEmail",
      orgId: "decks.orgId",
      updatedAt: "decks.updatedAt",
    },
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
  getRequestOrgId: () => "org-1",
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
  registerShareableResource: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (left: unknown, right: unknown) => ({ left, right }),
    sql: actual.sql,
  };
});

vi.mock("../server/handlers/import/pptx-assets.js", () => ({
  assertPptxImageByteLimits: vi.fn(),
  assertPptxImagesRenderable: vi.fn(),
  MAX_PPTX_IMAGE_BYTES: 10 * 1024 * 1024,
  MAX_PPTX_IMAGES_TOTAL_BYTES: 40 * 1024 * 1024,
  uploadPptxSlideImages: (...args: unknown[]) =>
    mocks.uploadPptxSlideImages(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mocks.notifyClients(...args),
}));

vi.mock("../server/lib/imported-asset-batch.js", () => ({
  ImportedAssetBatch: class {
    track() {}
    markCommitted() {}
  },
  withImportedAssetCleanup: (_batch: unknown, work: () => unknown) => work(),
}));

vi.mock("../server/handlers/import/pptx-parser.js", () => ({
  parsePptx: (...args: unknown[]) => mocks.parsePptx(...args),
}));

vi.mock("../server/lib/slide-asset-references.js", () => ({
  withSlideAssetReferencesLocked: (...args: unknown[]) =>
    mocks.withSlideAssetReferencesLocked(...args),
}));

vi.mock("../server/handlers/import/html-converter.js", () => ({
  convertToSlideHtml: vi.fn(() => '<div class="fmd-slide"></div>'),
}));

vi.mock("./_imported-slide-source.js", () => ({
  compileImportedSlideSource: vi.fn(async () => ({
    content: '<div class="fmd-slide"></div>',
    sourceTsx: "export default function Slide() { return null; }",
    revision: 1,
    sourceHash: "source-hash",
  })),
}));

import {
  InvalidPptxSourceError,
  SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
} from "../shared/source-import-errors.js";
import { importPptxBufferToDeck } from "./import-pptx";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertAccess.mockReset().mockResolvedValue(undefined);
  mocks.notifyClients.mockReset().mockResolvedValue(undefined);
  mocks.writeAppState.mockReset().mockResolvedValue(undefined);
  mocks.withSlideAssetReferencesLocked.mockReset();
  mocks.withSlideAssetReferencesLocked.mockImplementation(
    async (...args: unknown[]) => {
      const [, , , write] = args;
      return (write as (tx: unknown) => Promise<unknown>)(args[0]);
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createImportDb(existingDeck?: Record<string, unknown>) {
  let insertedValues: Record<string, unknown> | undefined;
  let updatedValues: Record<string, unknown> | undefined;
  const rows = existingDeck ? [existingDeck] : [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() =>
          Object.assign(Promise.resolve(rows), {
            limit: async () => rows,
          }),
        ),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        insertedValues = values;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updatedValues = values;
        return {
          where: vi.fn(async () => ({ rowsAffected: 1 })),
        };
      }),
    })),
  };
  return {
    db,
    get insertedValues() {
      return insertedValues;
    },
    get updatedValues() {
      return updatedValues;
    },
  };
}

function parsedPresentation() {
  return {
    title: "Imported deck",
    slides: [{ texts: [], images: [], elements: [] }],
  } as any;
}

function existingDeck() {
  return {
    id: "deck-1",
    title: "Existing deck",
    data: JSON.stringify({
      appId: "slides-2",
      title: "Existing deck",
      slides: [],
    }),
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    designSystemId: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function allowPptxImageUploads() {
  mocks.uploadPptxSlideImages.mockResolvedValue({
    urls: {},
    assets: {},
    imageSkippedCount: 0,
  });
}

describe("importPptxBufferToDeck parse failures", () => {
  it("returns a typed no-write failure before database access or image uploads", async () => {
    mocks.parsePptx.mockRejectedValue(
      new InvalidPptxSourceError(new Error("Invalid PPTX: broken archive")),
    );

    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.from("invalid PPTX"),
        deckId: "deck-1",
      }),
    ).rejects.toMatchObject({
      errorCode: SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
      message: expect.stringContaining("No slides were written"),
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
  });

  it("preserves an already typed parser error", async () => {
    const typedError = Object.assign(new Error("Parser unavailable"), {
      errorCode: "pptx_parser_unavailable",
      statusCode: 503,
    });
    mocks.parsePptx.mockRejectedValue(typedError);

    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.from("invalid PPTX"),
        deckId: "deck-1",
      }),
    ).rejects.toBe(typedError);

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
  });

  it("preserves unexpected parser errors", async () => {
    const parserError = new Error("Unexpected parser failure");
    mocks.parsePptx.mockRejectedValue(parserError);

    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.from("invalid PPTX"),
        deckId: "deck-1",
      }),
    ).rejects.toBe(parserError);

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
  });
});

describe("importPptxBufferToDeck empty presentations", () => {
  it("rejects before database access or image uploads", async () => {
    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.alloc(0),
        parsedPresentation: { title: "Empty presentation", slides: [] },
      }),
    ).rejects.toMatchObject({
      errorCode: SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
      message: expect.stringContaining("No deck was written"),
    });

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
  });
});

describe("importPptxBufferToDeck app scope", () => {
  it("rejects a foreign app deck before uploading any images", async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi
              .fn()
              .mockResolvedValue([
                { data: JSON.stringify({ appId: "slides", slides: [] }) },
              ]),
          })),
        })),
      })),
    };
    mocks.getDb.mockReturnValue(db);
    const parsedPresentation = {
      title: "Foreign deck",
      slides: [{ texts: [], images: [], elements: [] }],
    } as any;

    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.from("pptx"),
        parsedPresentation,
        deckId: "deck-1",
      }),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "deck_not_found" });

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
  });
});

describe("importPptxBufferToDeck design-system access", () => {
  it.each(["new", "existing"] as const)(
    "rejects an unauthorized design-system link for a %s deck before uploads or writes",
    async (kind) => {
      const fixture = createImportDb(
        kind === "existing" ? existingDeck() : undefined,
      );
      mocks.getDb.mockReturnValue(fixture.db);
      const accessError = new Error("forbidden");
      if (kind === "existing") {
        mocks.assertAccess
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(accessError);
      } else {
        mocks.assertAccess.mockRejectedValueOnce(accessError);
      }

      await expect(
        importPptxBufferToDeck({
          fileBuffer: Buffer.from("pptx"),
          parsedPresentation: parsedPresentation(),
          ...(kind === "existing" ? { deckId: "deck-1" } : {}),
          designSystemId: "private-design-system",
        }),
      ).rejects.toBe(accessError);

      expect(mocks.assertAccess).toHaveBeenCalledWith(
        "design-system",
        "private-design-system",
        "viewer",
      );
      expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
      expect(fixture.insertedValues).toBeUndefined();
      expect(fixture.updatedValues).toBeUndefined();
    },
  );

  it.each(["new", "existing"] as const)(
    "links an authorized design system for a %s deck",
    async (kind) => {
      const fixture = createImportDb(
        kind === "existing" ? existingDeck() : undefined,
      );
      mocks.getDb.mockReturnValue(fixture.db);
      allowPptxImageUploads();

      await importPptxBufferToDeck({
        fileBuffer: Buffer.from("pptx"),
        parsedPresentation: parsedPresentation(),
        ...(kind === "existing" ? { deckId: "deck-1" } : {}),
        designSystemId: "design-system-1",
      });

      expect(mocks.assertAccess).toHaveBeenCalledWith(
        "design-system",
        "design-system-1",
        "viewer",
      );
      expect(
        kind === "existing"
          ? fixture.updatedValues?.designSystemId
          : fixture.insertedValues?.designSystemId,
      ).toBe("design-system-1");
    },
  );
});

describe("importPptxBufferToDeck post-commit effects", () => {
  it("returns the committed import when notification and refresh fail", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn(() => ({ values })),
    };
    mocks.getDb.mockReturnValue(db);
    mocks.uploadPptxSlideImages.mockResolvedValue({
      urls: {},
      assets: {},
      imageSkippedCount: 0,
    });
    mocks.notifyClients.mockRejectedValue(new Error("socket unavailable"));
    mocks.writeAppState.mockRejectedValue(
      new Error("refresh store unavailable"),
    );

    const result = await importPptxBufferToDeck({
      fileBuffer: Buffer.from("pptx"),
      title: "Imported deck",
      parsedPresentation: {
        title: "Imported deck",
        slides: [{ texts: [], images: [], elements: [] }],
      },
    });

    expect(values).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      imported: true,
      postCommitWarnings: [
        "client_notification_failed",
        "refresh_signal_failed",
      ],
    });
  });
});

describe("importPptxBufferToDeck post-commit notifications", () => {
  it("returns the committed deck when client notification and refresh signal fail", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    mocks.getDb.mockReturnValue({ insert });
    mocks.uploadPptxSlideImages.mockResolvedValue({
      urls: {},
      assets: {},
      imageSkippedCount: 0,
    });
    mocks.notifyClients.mockRejectedValue(new Error("client bus unavailable"));
    mocks.writeAppState.mockRejectedValue(new Error("state store unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await importPptxBufferToDeck({
      fileBuffer: Buffer.from("pptx"),
      parsedPresentation: parsedPresentation(),
    });

    expect(result).toMatchObject({
      title: "Imported deck",
      slideCount: 1,
      imported: true,
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(mocks.notifyClients).toHaveBeenCalledWith(result.id);
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ source: "import-pptx" }),
    );
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
