import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  insertAsset: vi.fn(),
  resolveSlidesRequestAuth: vi.fn(),
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

  await uploadAsset(event as never);

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
    error: "Image upload failed",
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
    error: "Image upload failed",
  });

  expect(getResponseStatus(event as never)).toBe(400);
  expect(mocks.uploadFile).not.toHaveBeenCalled();
  expect(mocks.insertAsset).not.toHaveBeenCalled();
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
    error: "Only valid MP4 and WebM videos are allowed",
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
