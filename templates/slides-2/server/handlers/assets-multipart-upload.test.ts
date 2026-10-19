import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  insertAsset: vi.fn(),
  resolveSlidesRequestAuth: vi.fn(),
  assertDeckAssetUploadScope: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => ({
  deleteUploadedFile: vi.fn(),
  uploadFile: mocks.uploadFile,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => "active-org",
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({ insert: () => ({ values: mocks.insertAsset }) }),
  schema: { uploadedAssets: {} },
}));

vi.mock("../lib/chunked-upload-session.js", () => ({
  deleteOrphanedVideoAssetCleanup: vi.fn(),
  listOrphanedVideoAssetCleanups: vi.fn(),
  recordOrphanedVideoAssetCleanup: vi.fn(),
}));

vi.mock("../lib/deck-asset-scope.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/deck-asset-scope.js")>();
  return {
    ...actual,
    assertDeckAssetUploadScope: (...args: unknown[]) =>
      mocks.assertDeckAssetUploadScope(...args),
  };
});

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: mocks.resolveSlidesRequestAuth,
}));

vi.mock("h3", async (importOriginal) => {
  const h3 = await importOriginal<typeof import("h3")>();
  return { ...h3, defineEventHandler: (handler: unknown) => handler };
});

import { getResponseStatus, mockEvent } from "h3";

import {
  MAX_ASSET_REQUEST_SIZE,
  MAX_VIDEO_ASSET_REQUEST_SIZE,
  uploadAsset,
  uploadVideoAssetHandler,
} from "./assets";

beforeEach(() => {
  mocks.uploadFile.mockReset();
  mocks.uploadFile.mockResolvedValue({
    provider: "test-storage",
    url: "https://files.example.test/sample.png",
  });
  mocks.insertAsset.mockReset();
  mocks.insertAsset.mockResolvedValue(undefined);
  mocks.resolveSlidesRequestAuth.mockReset();
  mocks.resolveSlidesRequestAuth.mockResolvedValue({
    ok: true,
    context: { email: "owner@example.test", orgId: "active-org" },
  });
  mocks.assertDeckAssetUploadScope.mockResolvedValue(undefined);
});

it("accepts a PNG multipart upload after enforcing the request size limit", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: "image/png",
    }),
    "sample.png",
  );
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload", {
      method: "POST",
      body: form,
    }),
  );

  await expect(uploadAsset(event as never)).resolves.toMatchObject({
    id: expect.any(String),
    url: "https://files.example.test/sample.png",
    filename: "sample.png",
    type: "image/png",
    size: 8,
    provider: "test-storage",
  });

  expect(mocks.uploadFile).toHaveBeenCalledWith(
    expect.objectContaining({
      filename: "sample.png",
      mimeType: "image/png",
      ownerEmail: "owner@example.test",
    }),
  );
  expect(mocks.insertAsset).toHaveBeenCalledOnce();
  expect(mocks.insertAsset).toHaveBeenCalledWith(
    expect.objectContaining({ deckId: null }),
  );
});

it("associates an image upload with an editor-authorized deck catalog", async () => {
  const form = new FormData();
  form.append("deckId", "deck-1");
  form.append(
    "file",
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: "image/png",
    }),
    "sample.png",
  );
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload", {
      method: "POST",
      body: form,
    }),
  );

  await expect(uploadAsset(event as never)).resolves.toMatchObject({
    url: "https://files.example.test/sample.png",
  });

  expect(mocks.assertDeckAssetUploadScope).toHaveBeenCalledWith({
    deckId: "deck-1",
    email: "owner@example.test",
    orgId: "active-org",
  });
  expect(mocks.insertAsset).toHaveBeenCalledWith(
    expect.objectContaining({ deckId: "deck-1" }),
  );
});

it("rejects a foreign deck before uploading or inserting an image asset", async () => {
  mocks.assertDeckAssetUploadScope.mockRejectedValueOnce(
    Object.assign(new Error("Deck not found."), {
      statusCode: 404,
      errorCode: "deck_not_found",
    }),
  );
  const form = new FormData();
  form.append("deckId", "foreign-deck");
  form.append(
    "file",
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: "image/png",
    }),
    "sample.png",
  );
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload", {
      method: "POST",
      body: form,
    }),
  );

  await expect(uploadAsset(event as never)).resolves.toEqual({
    error: "This presentation could not be found.",
    errorCode: "deck_not_found",
  });

  expect(getResponseStatus(event as never)).toBe(404);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
  expect(mocks.insertAsset).not.toHaveBeenCalled();
});

it("returns 413 when an image multipart request exceeds the real body limit", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_ASSET_REQUEST_SIZE));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=upload" },
      body,
      duplex: "half",
    } as RequestInit),
  );

  await expect(uploadAsset(event as never)).resolves.toEqual({
    error: "Image files must be 10 MB or smaller.",
    errorCode: "image_upload_too_large",
  });

  expect(getResponseStatus(event as never)).toBe(413);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
  expect(mocks.insertAsset).not.toHaveBeenCalled();
});

it("returns 400 for malformed image multipart data without writing an asset", async () => {
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=upload" },
      body: "not multipart data",
    }),
  );

  await expect(uploadAsset(event as never)).resolves.toEqual({
    error: "The upload request could not be read.",
    errorCode: "image_upload_request_invalid",
  });

  expect(getResponseStatus(event as never)).toBe(400);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
  expect(mocks.insertAsset).not.toHaveBeenCalled();
});

it("returns 400 for non-multipart image uploads without writing an asset", async () => {
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );

  await expect(uploadAsset(event as never)).resolves.toEqual({
    error: "The upload request could not be read.",
    errorCode: "image_upload_request_invalid",
  });

  expect(getResponseStatus(event as never)).toBe(400);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
  expect(mocks.insertAsset).not.toHaveBeenCalled();
});

it("returns a typed error when an image upload contains no file", async () => {
  const form = new FormData();
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload", {
      method: "POST",
      body: form,
    }),
  );

  await expect(uploadAsset(event as never)).resolves.toEqual({
    error: "Choose an image to upload.",
    errorCode: "image_upload_file_missing",
  });

  expect(getResponseStatus(event as never)).toBe(400);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
  expect(mocks.insertAsset).not.toHaveBeenCalled();
});

it("does not return provider diagnostics from a failed image upload", async () => {
  mocks.uploadFile.mockRejectedValueOnce(
    new Error("provider-secret-region and private storage endpoint"),
  );
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: "image/png",
    }),
    "sample.png",
  );
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload", {
      method: "POST",
      body: form,
    }),
  );

  await expect(uploadAsset(event as never)).resolves.toEqual({
    error: "Image storage is temporarily unavailable. Try again.",
    errorCode: "image_upload_storage_failed",
  });

  expect(getResponseStatus(event as never)).toBe(502);
  expect(mocks.insertAsset).not.toHaveBeenCalled();
});

it("returns a typed error when image storage is not configured", async () => {
  mocks.uploadFile.mockResolvedValueOnce(null);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: "image/png",
    }),
    "sample.png",
  );
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload", {
      method: "POST",
      body: form,
    }),
  );

  await expect(uploadAsset(event as never)).resolves.toEqual({
    error: "Connect file storage before uploading images.",
    errorCode: "image_upload_storage_unavailable",
  });

  expect(getResponseStatus(event as never)).toBe(503);
  expect(mocks.insertAsset).not.toHaveBeenCalled();
});

it("does not return database diagnostics when image registration fails", async () => {
  mocks.insertAsset.mockRejectedValueOnce(
    new Error("private database connection details"),
  );
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: "image/png",
    }),
    "sample.png",
  );
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload", {
      method: "POST",
      body: form,
    }),
  );

  await expect(uploadAsset(event as never)).resolves.toEqual({
    error: "The uploaded image couldn't be saved. Try again.",
    errorCode: "image_asset_registration_failed",
  });

  expect(getResponseStatus(event as never)).toBe(500);
  expect(mocks.insertAsset).toHaveBeenCalledOnce();
});

it("parses video multipart data before validating the video file", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
    "clip.mp4",
  );
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload-video", {
      method: "POST",
      body: form,
    }),
  );

  await expect(uploadVideoAssetHandler(event as never)).resolves.toEqual({
    error: "Only valid MP4 and WebM videos are allowed.",
    errorCode: "video_upload_invalid_format",
  });

  expect(getResponseStatus(event as never)).toBe(400);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
  expect(mocks.insertAsset).not.toHaveBeenCalled();
});

it("returns 413 when a video multipart request exceeds the real body limit", async () => {
  let remaining = MAX_VIDEO_ASSET_REQUEST_SIZE + 1;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const size = Math.min(1024 * 1024, remaining);
      controller.enqueue(new Uint8Array(size));
      remaining -= size;
      if (remaining === 0) controller.close();
    },
  });
  const event = mockEvent(
    new Request("https://slides.example.test/api/assets/upload-video", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=upload" },
      body,
      duplex: "half",
    } as RequestInit),
  );

  await uploadVideoAssetHandler(event as never);

  expect(getResponseStatus(event as never)).toBe(413);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
  expect(mocks.insertAsset).not.toHaveBeenCalled();
});
