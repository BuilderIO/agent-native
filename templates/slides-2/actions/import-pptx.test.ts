import { beforeEach, describe, expect, it, vi } from "vitest";

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
  schema: { decks: { id: "decks.id", data: "decks.data" } },
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
  uploadPptxSlideImages: (...args: unknown[]) =>
    mocks.uploadPptxSlideImages(...args),
}));

vi.mock("../server/handlers/import/pptx-parser.js", () => ({
  parsePptx: (...args: unknown[]) => mocks.parsePptx(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mocks.notifyClients(...args),
}));

vi.mock("../server/lib/slide-asset-references.js", () => ({
  withSlideAssetReferencesLocked: (...args: unknown[]) =>
    mocks.withSlideAssetReferencesLocked(...args),
}));

vi.mock("../server/handlers/import/html-converter.js", () => ({
  convertToSlideHtml: vi.fn(() => "<div class=\"fmd-slide\"></div>"),
}));

vi.mock("./_imported-slide-source.js", () => ({
  compileImportedSlideSource: vi.fn(async () => ({
    content: "<div class=\"fmd-slide\"></div>",
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
  mocks.notifyClients.mockReset();
  mocks.writeAppState.mockReset();
  mocks.withSlideAssetReferencesLocked.mockImplementation(
    async (...args: unknown[]) => {
      const [, , , write] = args;
      return (write as (tx: unknown) => Promise<unknown>)(args[0]);
    },
  );
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
    mocks.writeAppState.mockRejectedValue(new Error("refresh store unavailable"));

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
