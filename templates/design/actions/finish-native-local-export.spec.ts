import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dimensions: { width: 1600, height: 976 },
  save: vi.fn(async () => true),
}));
vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: (message: string, details: object) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("@agent-native/core/application-state", () => ({
  compareAndSetAppState: mocks.save,
}));
vi.mock("@agent-native/core/private-blob", () => ({
  resolveAttachment: async () => ({
    status: "ok",
    file: {
      filename: "native-export-00000000-0000-4000-8000-000000000000.png",
      mimeType: "image/png",
      size: 8,
      data: Buffer.from("test-png"),
    },
  }),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "viewer@example.test",
}));
vi.mock("@agent-native/core/sharing", () => ({ assertAccess: vi.fn() }));
vi.mock("../server/lib/png-dimensions.js", () => ({
  pngDimensions: () => mocks.dimensions,
}));
vi.mock("./_native-local-export-server.js", () => ({
  assertNativeLocalExportEditor: vi.fn(),
  expireNativeLocalExportState: async (state: unknown) => state,
  readNativeLocalExportState: async () => mocks.state,
  readNativeLocalExportVersion: async () => ({ versionHash: "source-v1" }),
  requireNativeLocalExportTabId: () => "test-tab",
}));

import finish from "./finish-native-local-export";

const input = {
  designId: "design-test",
  requestId: "00000000-0000-4000-8000-000000000000",
  documentId: "11111111-1111-4111-8111-111111111111",
  result: { status: "completed", attachmentRef: "test-attachment" },
};
beforeEach(() => {
  mocks.save.mockClear();
  mocks.dimensions = { width: 1600, height: 976 };
  mocks.state = {
    requestId: input.requestId,
    ownerDocumentId: input.documentId,
    status: "running",
    fileId: "file-test",
    expectedVersionHash: "source-v1",
    attachmentRef: "test-attachment",
    export: {
      format: "png",
      viewport: { width: 1600, height: 976 },
      pixelRatio: 1,
    },
  };
});
function invoke() {
  return (finish as unknown as { run(args: unknown): Promise<unknown> }).run(
    input,
  );
}

describe("native export completion dimensions", () => {
  it("completes a verified full viewport attachment", async () => {
    await expect(invoke()).resolves.toMatchObject({
      status: "completed",
      bytes: 8,
    });
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("completes a verified negative-coordinate crop attachment", async () => {
    Object.assign(mocks.state.export as object, {
      cropRect: { x: -32, y: -156, width: 715, height: 475 },
    });
    mocks.dimensions = { width: 715, height: 475 };
    await expect(invoke()).resolves.toMatchObject({
      status: "completed",
      bytes: 8,
    });
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("rejects viewport-sized bytes when a crop was claimed", async () => {
    Object.assign(mocks.state.export as object, {
      cropRect: { x: -32, y: -156, width: 715, height: 475 },
    });
    await expect(invoke()).rejects.toMatchObject({
      errorCode: "native_export_attachment_mismatch",
      statusCode: 422,
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
