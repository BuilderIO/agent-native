import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dimensions: { width: 1600, height: 976 },
  mint: vi.fn(async () => ({ status: "ok", ref: "test-attachment" })),
  remove: vi.fn(async () => ({ status: "ok" })),
  save: vi.fn(
    async (
      _key: string,
      _current: Record<string, unknown>,
      _next: Record<string, unknown>,
    ) => true,
  ),
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
  deleteAttachment: mocks.remove,
  getActivePrivateBlobProviderForRequest: async () => ({}),
  mintAttachmentRef: mocks.mint,
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
vi.mock("@agent-native/core/server", () => ({
  getSession: async () => ({ email: "viewer@example.test", orgId: "test-org" }),
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "viewer@example.test",
}));
vi.mock("@agent-native/core/sharing", () => ({ assertAccess: vi.fn() }));
vi.mock("../../../actions/_native-local-export-server.js", () => ({
  readNativeLocalExportState: async () => mocks.state,
  readNativeLocalExportVersion: async () => ({ versionHash: "source-v1" }),
  assertNativeLocalExportEditor: vi.fn(),
  expireNativeLocalExportState: async (state: unknown) => state,
  requireNativeLocalExportTabId: () => "test-tab",
}));
vi.mock("../../../actions/_native-render-contexts.js", () => ({
  resolveNativeRenderContextTarget: vi.fn(),
}));
vi.mock("../../lib/png-dimensions.js", () => ({
  pngDimensions: () => mocks.dimensions,
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  createError: (details: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(details.statusMessage), details),
  readMultipartFormData: async () => [
    { name: "designId", data: Buffer.from("design-test") },
    {
      name: "requestId",
      data: Buffer.from("00000000-0000-4000-8000-000000000000"),
    },
    {
      name: "documentId",
      data: Buffer.from("11111111-1111-4111-8111-111111111111"),
    },
    { name: "tabId", data: Buffer.from("test-tab") },
    {
      name: "file",
      type: "image/png",
      filename: "export.png",
      data: Buffer.from("test-png"),
    },
  ],
}));

import finish from "../../../actions/finish-native-local-export";
import upload from "./native-png-attachment.post";

beforeEach(() => {
  mocks.mint.mockReset();
  mocks.mint.mockResolvedValue({ status: "ok", ref: "test-attachment" });
  mocks.remove.mockClear();
  mocks.save.mockReset();
  mocks.save.mockImplementation(async (_key, current, next) => {
    if (mocks.state !== current) return false;
    mocks.state = next;
    return true;
  });
  mocks.dimensions = { width: 1600, height: 976 };
  mocks.state = {
    requestId: "00000000-0000-4000-8000-000000000000",
    ownerDocumentId: "11111111-1111-4111-8111-111111111111",
    status: "running",
    fileId: "file-test",
    expectedVersionHash: "source-v1",
    export: {
      format: "png",
      viewport: { width: 1600, height: 976 },
      pixelRatio: 1,
    },
  };
});

async function invokeUpload() {
  return (upload as unknown as (event: { req: Request }) => Promise<unknown>)({
    req: new Request("http://localhost/api/native-png-attachment", {
      method: "POST",
      body: "bounded multipart",
    }),
  });
}

async function invokeFinish() {
  return (finish as unknown as { run(args: unknown): Promise<unknown> }).run({
    designId: "design-test",
    requestId: "00000000-0000-4000-8000-000000000000",
    documentId: "11111111-1111-4111-8111-111111111111",
    result: { status: "completed", attachmentRef: "test-attachment" },
  });
}

describe("native PNG upload and completion", () => {
  it("publishes a verified attachment after releasing the upload claim", async () => {
    await expect(invokeUpload()).resolves.toEqual({
      attachmentRef: "test-attachment",
      bytes: 8,
    });
    expect(
      mocks.save.mock.calls.map(([, before, after]) => [
        before.status,
        after.status,
      ]),
    ).toEqual([
      ["running", "uploading"],
      ["uploading", "running"],
    ]);
    expect(mocks.state).toMatchObject({
      status: "running",
      fileId: "file-test",
      expectedVersionHash: "source-v1",
      attachmentRef: "test-attachment",
      attachmentBytes: 8,
    });

    await expect(invokeFinish()).resolves.toMatchObject({
      status: "completed",
      fileId: "file-test",
      attachmentRef: "test-attachment",
      bytes: 8,
    });
    expect(mocks.state).toMatchObject({
      status: "completed",
      fileId: "file-test",
      expectedVersionHash: "source-v1",
      attachmentRef: "test-attachment",
      attachmentBytes: 8,
    });
    expect(
      mocks.save.mock.calls[mocks.save.mock.calls.length - 1]?.[1],
    ).toMatchObject({ status: "running" });
  });

  it("does not complete a canceled request after upload", async () => {
    await invokeUpload();
    mocks.state = { ...mocks.state, status: "cancel-requested" };
    await expect(invokeFinish()).rejects.toMatchObject({
      errorCode: "native_export_request_not_running",
      statusCode: 409,
    });
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it("removes an attachment when cancellation wins during upload", async () => {
    mocks.mint.mockImplementation(async () => {
      mocks.state = { ...mocks.state, status: "cancel-requested" };
      return { status: "ok", ref: "test-attachment" };
    });
    await expect(invokeUpload()).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.remove).toHaveBeenCalledWith("test-attachment", {
      ownerEmail: "viewer@example.test",
      orgId: null,
    });
    expect(mocks.state).toMatchObject({ status: "cancel-requested" });
    expect(mocks.state).not.toHaveProperty("attachmentRef");
  });
});

describe("native PNG attachment dimensions", () => {
  it("accepts the claimed full viewport", async () => {
    await expect(invokeUpload()).resolves.toEqual({
      attachmentRef: "test-attachment",
      bytes: 8,
    });
    expect(mocks.mint).toHaveBeenCalledOnce();
  });

  it("accepts a negative-coordinate crop at its output dimensions", async () => {
    Object.assign(mocks.state.export as object, {
      cropRect: { x: -32, y: -156, width: 715, height: 475 },
    });
    mocks.dimensions = { width: 715, height: 475 };
    await expect(invokeUpload()).resolves.toEqual({
      attachmentRef: "test-attachment",
      bytes: 8,
    });
    expect(mocks.mint).toHaveBeenCalledOnce();
  });

  it("rejects a full viewport image when the request claimed a crop", async () => {
    Object.assign(mocks.state.export as object, {
      cropRect: { x: -32, y: -156, width: 715, height: 475 },
    });
    await expect(invokeUpload()).rejects.toMatchObject({ statusCode: 422 });
    expect(mocks.mint).not.toHaveBeenCalled();
  });
});
