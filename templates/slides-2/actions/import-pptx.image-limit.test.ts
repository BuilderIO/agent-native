import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  parsePptx: vi.fn(),
  uploadPptxSlideImages: vi.fn(),
  assertAccess: vi.fn(async () => undefined),
  notifyClients: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: { decks: { id: "decks.id", data: "decks.data" } },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
  getRequestOrgId: () => "org-1",
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
  MAX_PPTX_IMAGE_BYTES: 10 * 1024 * 1024,
  MAX_PPTX_IMAGES_TOTAL_BYTES: 40 * 1024 * 1024,
  assertPptxImageByteLimits: vi.fn(),
  assertPptxImagesRenderable: vi.fn(),
  uploadPptxSlideImages: (...args: unknown[]) =>
    mocks.uploadPptxSlideImages(...args),
}));

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: (...args: unknown[]) => mocks.notifyClients(...args),
}));

vi.mock("../server/handlers/import/html-converter.js", () => ({
  convertToSlideHtml: () => "<main>Imported slide</main>",
}));

vi.mock("../server/lib/imported-asset-batch.js", () => ({
  ImportedAssetBatch: class {
    track() {}
    markCommitted() {}
  },
  withImportedAssetCleanup: (_batch: unknown, work: () => unknown) => work(),
}));

vi.mock("../server/lib/slide-asset-references.js", () => ({
  withSlideAssetReferencesLocked: (
    db: unknown,
    _data: unknown,
    _scope: unknown,
    write: (tx: unknown) => unknown,
  ) => write(db),
}));

vi.mock("./_imported-slide-source.js", () => ({
  compileImportedSlideSource: async () => ({
    sourceTsx: "export default function Slide() { return null; }",
  }),
}));

vi.mock("../server/handlers/import/pptx-parser.js", () => ({
  parsePptxWithImageByteLimits: (...args: unknown[]) =>
    mocks.parsePptx(...args),
}));

import { PptxImageByteLimitError } from "@agent-native/core/ingestion";

import { importPptxBufferToDeck } from "./import-pptx";

const MAX_PPTX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PPTX_IMAGES_TOTAL_BYTES = 40 * 1024 * 1024;

describe("PPTX import image size limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyClients.mockResolvedValue(undefined);
    mocks.writeAppState.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes image limits to the parser and fails before database writes", async () => {
    const error = new PptxImageByteLimitError(
      "aggregate",
      MAX_PPTX_IMAGES_TOTAL_BYTES,
    );
    const fileBuffer = Buffer.from("oversized pptx image");
    mocks.parsePptx.mockRejectedValue(error);

    await expect(importPptxBufferToDeck({ fileBuffer })).rejects.toMatchObject({
      errorCode: "pptx_image_size_limit",
      statusCode: 413,
      message: expect.stringContaining("40 MB total limit"),
    });

    expect(mocks.parsePptx).toHaveBeenCalledWith(fileBuffer, {
      maxImageBytes: MAX_PPTX_IMAGE_BYTES,
      maxTotalImageBytes: MAX_PPTX_IMAGES_TOTAL_BYTES,
    });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.uploadPptxSlideImages).not.toHaveBeenCalled();
  });

  it("returns committed and notification status after a successful deck write", async () => {
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
      parsedPresentation: {
        title: "Imported deck",
        slides: [{ texts: [], images: [], elements: [] }],
      } as never,
    });

    expect(result).toMatchObject({
      imported: true,
      postCommit: {
        committed: true,
        clientNotification: "failed",
        refreshSignal: "failed",
      },
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("reports helper completion separately from refresh persistence", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    mocks.getDb.mockReturnValue({ insert });
    mocks.uploadPptxSlideImages.mockResolvedValue({
      urls: {},
      assets: {},
      imageSkippedCount: 0,
    });

    const result = await importPptxBufferToDeck({
      fileBuffer: Buffer.from("pptx"),
      parsedPresentation: {
        title: "Imported deck",
        slides: [{ texts: [], images: [], elements: [] }],
      } as never,
    });

    expect(result.postCommit).toEqual({
      committed: true,
      clientNotification: "helper-returned",
      refreshSignal: "written",
    });
  });
});
