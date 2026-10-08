import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getDb: vi.fn(),
  getRouterParam: vi.fn(),
  getSession: vi.fn(),
  readPrivateBlob: vi.fn(),
  row: undefined as
    | {
        designId: string;
        blobHandle: string;
        mimeType: string;
        sizeBytes: number;
      }
    | undefined,
  runWithRequestContext: vi.fn(),
  setResponseHeader: vi.fn(),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  isPrivateBlobError: () => false,
  readPrivateBlob: mocks.readPrivateBlob,
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  runWithRequestContext: mocks.runWithRequestContext,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("h3", () => ({
  createError: ({
    statusCode,
    statusMessage,
  }: {
    statusCode: number;
    statusMessage: string;
  }) => Object.assign(new Error(statusMessage), { statusCode, statusMessage }),
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: mocks.getRouterParam,
  setResponseHeader: mocks.setResponseHeader,
}));

vi.mock("../../../db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    designBoardReplayScreenshots: {
      designId: "screenshots.designId",
      blobHandle: "screenshots.blobHandle",
      id: "screenshots.id",
      mimeType: "screenshots.mimeType",
      sizeBytes: "screenshots.sizeBytes",
    },
  },
}));

import handler from "./[screenshotId].get.js";

function makeEvent() {
  return { screenshotId: "screenshot-id" };
}

describe("GET /api/design-board-replay-screenshots/:screenshotId", () => {
  const imageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.row = {
      designId: "design-id",
      blobHandle: JSON.stringify({
        id: "public-upload:v1:encrypted-descriptor",
        provider: "public-upload:builder-storage",
        opaque: true,
        encrypted: true,
      }),
      mimeType: "image/png",
      sizeBytes: imageData.byteLength,
    };
    mocks.getSession.mockResolvedValue({
      email: "designer@example.test",
      orgId: "org-id",
    });
    mocks.getRouterParam.mockReturnValue("screenshot-id");
    mocks.runWithRequestContext.mockImplementation((_context, callback) =>
      callback(),
    );
    mocks.setResponseHeader.mockImplementation(() => undefined);
    mocks.assertAccess.mockResolvedValue({ role: "viewer" });
    mocks.readPrivateBlob.mockResolvedValue({
      data: imageData,
      mimeType: "image/png",
    });
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [mocks.row] }),
        }),
      }),
    });
  });

  it("reads an encrypted upload fallback only after checking board access", async () => {
    const result = await handler(makeEvent() as never);

    expect(Buffer.from(result as Uint8Array)).toEqual(Buffer.from(imageData));
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-id",
      "viewer",
    );
    expect(mocks.assertAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readPrivateBlob.mock.invocationCallOrder[0]!,
    );
    expect(mocks.readPrivateBlob).toHaveBeenCalledWith({
      id: "public-upload:v1:encrypted-descriptor",
      provider: "public-upload:builder-storage",
      opaque: true,
      encrypted: true,
    });
  });

  it("rejects fallback handles without both prefixes and encryption", async () => {
    mocks.row!.blobHandle = JSON.stringify({
      id: "public-upload:v1:encrypted-descriptor",
      provider: "builder-storage",
      opaque: true,
      encrypted: false,
    });

    await expect(handler(makeEvent() as never)).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: "Screenshot not found",
    });

    expect(mocks.readPrivateBlob).not.toHaveBeenCalled();
  });
});
