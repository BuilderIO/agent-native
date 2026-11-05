import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  parsePptx: vi.fn(),
  uploadPptxSlideImages: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: { decks: {} },
}));

vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestUserEmail: () => "owner@example.com",
    getRequestOrgId: () => undefined,
  }),
);

vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("../server/handlers/import/html-converter.js", () => ({
  convertToSlideHtml: () => "<div></div>",
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: vi.fn(),
}));

vi.mock("../server/handlers/import/pptx-assets.js", () => ({
  assertPptxImagesRenderable: vi.fn(),
  uploadPptxSlideImages: (...args: unknown[]) =>
    mocks.uploadPptxSlideImages(...args),
}));

vi.mock("../server/handlers/import/pptx-parser.js", () => ({
  parsePptx: (...args: unknown[]) => mocks.parsePptx(...args),
}));

import {
  InvalidPptxSourceError,
  SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
} from "../shared/source-import-errors.js";
import { importPptxBufferToDeck } from "./import-pptx";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("importPptxBufferToDeck overwrite and empty-file guards", () => {
  function fakeDb() {
    const db = {
      select: vi.fn(() => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: "deck-1",
                data: "{}",
                designSystemId: null,
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ]),
        }),
      })),
      insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
      update: vi.fn(() => ({
        set: () => ({ where: () => Promise.resolve({ rowsAffected: 1 }) }),
      })),
    };
    mocks.getDb.mockReturnValue(db);
    return db;
  }

  it("rejects a PPTX with no slides before creating a deck", async () => {
    const db = fakeDb();
    mocks.parsePptx.mockResolvedValue({
      slides: [],
      theme: undefined,
      title: "",
    });

    await expect(
      importPptxBufferToDeck({ fileBuffer: Buffer.from("empty") }),
    ).rejects.toMatchObject({
      errorCode: SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
      message: expect.stringContaining("no slides"),
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects overwriting an existing deck without replaceExisting", async () => {
    const db = fakeDb();
    mocks.uploadPptxSlideImages.mockResolvedValue({
      urls: {},
      imageSkippedCount: 0,
    });
    mocks.parsePptx.mockResolvedValue({
      slides: [{ texts: [], elements: [], images: [] }],
      theme: undefined,
      title: "Deck",
    });

    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.from("pptx"),
        deckId: "deck-1",
      }),
    ).rejects.toMatchObject({
      errorCode: SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
      message: expect.stringContaining("replaceExisting"),
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects replaceExisting without a deckId instead of creating a deck", async () => {
    const db = fakeDb();
    mocks.parsePptx.mockResolvedValue({
      slides: [{ texts: [], elements: [], images: [] }],
      theme: undefined,
      title: "Deck",
    });

    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.from("pptx"),
        replaceExisting: true,
      }),
    ).rejects.toMatchObject({
      errorCode: SOURCE_IMPORT_NO_WRITE_ERROR_CODE,
      message: expect.stringContaining("deckId"),
    });
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("importPptxBufferToDeck parse failures", () => {
  it("returns a typed no-write failure before database access or image uploads", async () => {
    mocks.parsePptx.mockRejectedValue(
      new InvalidPptxSourceError(new Error("Invalid PPTX: broken archive")),
    );

    await expect(
      importPptxBufferToDeck({
        fileBuffer: Buffer.from("invalid PPTX"),
        deckId: "deck-1",
        replaceExisting: true,
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
        replaceExisting: true,
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
        replaceExisting: true,
      }),
    ).rejects.toBe(parserError);

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
  });
});
