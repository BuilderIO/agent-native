import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertDeckAssetUploadScope: vi.fn(),
  mkdir: vi.fn(async () => undefined),
  resolveSlidesRequestAuth: vi.fn(),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "active-org",
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));

vi.mock("fs", () => ({
  default: {
    promises: {
      mkdir: mocks.mkdir,
      writeFile: mocks.writeFile,
    },
  },
}));

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: { uploadedAssets: {} },
}));

vi.mock("../lib/chunked-upload-session.js", () => ({
  deleteOrphanedVideoAssetCleanup: vi.fn(),
  listOrphanedVideoAssetCleanups: vi.fn(),
  recordOrphanedVideoAssetCleanup: vi.fn(),
}));

vi.mock("../lib/deck-asset-scope.js", () => ({
  assertDeckAssetUploadScope: mocks.assertDeckAssetUploadScope,
  parseOptionalDeckId: () => undefined,
}));

vi.mock("../lib/tenant-files.js", () => ({
  tenantUploadDir: () => "/tmp/slides-2-upload-boundary-test",
}));

vi.mock("../lib/uploaded-reference-storage.js", () => ({
  deleteUploadedReference: vi.fn(),
  isHostedSlidesRuntime: () => false,
  mintUploadedReference: vi.fn(),
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: mocks.resolveSlidesRequestAuth,
  withSlidesRequestContext: (
    _event: unknown,
    callback: (context: { email?: string; orgId?: string }) => unknown,
    context: { email?: string; orgId?: string },
  ) => callback(context),
}));

import { mockEvent } from "h3";

import { MAX_REFERENCE_UPLOAD_REQUEST_BYTES, uploadFiles } from "./uploads";

beforeEach(() => {
  mocks.assertDeckAssetUploadScope.mockReset();
  mocks.assertDeckAssetUploadScope.mockResolvedValue(undefined);
  mocks.mkdir.mockClear();
  mocks.resolveSlidesRequestAuth.mockReset();
  mocks.resolveSlidesRequestAuth.mockResolvedValue({
    ok: true,
    context: { email: "owner@example.test", orgId: "active-org" },
  });
  mocks.writeFile.mockClear();
});

it("parses a bounded multipart reference upload after limiting the request body", async () => {
  const form = new FormData();
  form.append(
    "files",
    new Blob(["alpha notes"], { type: "text/plain" }),
    "notes.txt",
  );
  const event = mockEvent(
    new Request("https://slides.example.test/api/uploads", {
      method: "POST",
      body: form,
    }),
  );

  await expect(uploadFiles(event as never)).resolves.toEqual([
    expect.objectContaining({
      originalName: "notes.txt",
      size: 11,
      type: "text/plain",
    }),
  ]);

  expect(mocks.writeFile).toHaveBeenCalledOnce();
  expect(mocks.assertDeckAssetUploadScope).toHaveBeenCalledWith({
    deckId: undefined,
    email: "owner@example.test",
    orgId: "active-org",
  });
});

it("rejects a declared oversized request before reading multipart data", async () => {
  const event = mockEvent(
    new Request("https://slides.example.test/api/uploads", {
      method: "POST",
      headers: {
        "content-length": String(MAX_REFERENCE_UPLOAD_REQUEST_BYTES + 1),
        "content-type": "multipart/form-data; boundary=upload",
      },
      body: "--upload--",
    }),
  );

  await expect(uploadFiles(event as never)).rejects.toMatchObject({
    statusCode: 413,
  });
  expect(mocks.writeFile).not.toHaveBeenCalled();
});
