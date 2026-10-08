import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertBodySize = vi.hoisted(() => vi.fn());
const mockReadMultipartFormData = vi.hoisted(() => vi.fn());
const mockReadRawBody = vi.hoisted(() => vi.fn());
const mockResolveSlidesRequestAuth = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/file-upload", () => ({ uploadFile: vi.fn() }));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: vi.fn(),
  runWithRequestContext: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: { uploadedAssets: {} },
}));

vi.mock("h3", () => ({
  assertBodySize: (...args: unknown[]) => mockAssertBodySize(...args),
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: vi.fn(),
  readMultipartFormData: (...args: unknown[]) =>
    mockReadMultipartFormData(...args),
  readRawBody: (...args: unknown[]) => mockReadRawBody(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: (...args: unknown[]) =>
    mockResolveSlidesRequestAuth(...args),
}));

import {
  MAX_ASSET_REQUEST_SIZE,
  MAX_VIDEO_ASSET_REQUEST_SIZE,
  uploadAsset,
  uploadVideoAssetHandler,
} from "./assets";

describe("asset upload request size limit", () => {
  beforeEach(() => {
    mockAssertBodySize.mockReset();
    mockAssertBodySize.mockResolvedValue(undefined);
    mockReadMultipartFormData.mockReset();
    mockReadMultipartFormData.mockResolvedValue([]);
    mockReadRawBody.mockReset();
    mockReadRawBody.mockResolvedValue(new Uint8Array([1]));
    mockResolveSlidesRequestAuth.mockReset();
    mockResolveSlidesRequestAuth.mockResolvedValue({
      ok: true,
      context: { email: "owner@example.com", orgId: "active-org" },
    });
    mockSetResponseStatus.mockReset();
  });

  it.each([
    ["image", uploadAsset, MAX_ASSET_REQUEST_SIZE],
    ["video", uploadVideoAssetHandler, MAX_VIDEO_ASSET_REQUEST_SIZE],
  ] as const)(
    "limits the %s request before parsing multipart data",
    async (_kind, handler, limit) => {
      const event = {
        req: new Request("https://slides.example.test/api/assets/upload", {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=test" },
          body: "--test--\r\n",
        }),
      };

      await handler(event as never);

      expect(mockAssertBodySize).toHaveBeenCalledWith(event, limit);
      expect(mockAssertBodySize.mock.invocationCallOrder[0]).toBeLessThan(
        mockReadMultipartFormData.mock.invocationCallOrder[0],
      );
      expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 400);
    },
  );

  it("does not parse multipart data when the request exceeds its limit", async () => {
    mockAssertBodySize.mockRejectedValueOnce(
      Object.assign(new Error("too large"), { statusCode: 413 }),
    );
    const event = {
      req: new Request("https://slides.example.test/api/assets/upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
        body: "--test--\r\n",
      }),
    };

    await expect(uploadVideoAssetHandler(event as never)).resolves.toEqual({
      error: "too large",
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 413);
    expect(mockReadRawBody).not.toHaveBeenCalled();
    expect(mockReadMultipartFormData).not.toHaveBeenCalled();
  });

  it.each([
    ["image", uploadAsset],
    ["video", uploadVideoAssetHandler],
  ] as const)("rejects an empty %s multipart body", async (_kind, handler) => {
    mockReadRawBody.mockResolvedValueOnce(new Uint8Array(0));
    const event = {
      req: new Request("https://slides.example.test/api/assets/upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
      }),
    };

    const result = await handler(event as never);

    expect(result).toEqual({
      error: _kind === "image" ? "No file uploaded" : "No video uploaded",
    });
    expect(mockReadMultipartFormData).not.toHaveBeenCalled();
    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 400);
  });

  it("does not read an unauthenticated request body", async () => {
    mockResolveSlidesRequestAuth.mockResolvedValueOnce({
      ok: false,
      statusCode: 401,
      error: "Unauthorized",
    });
    const event = {};

    await uploadVideoAssetHandler(event as never);

    expect(mockAssertBodySize).not.toHaveBeenCalled();
    expect(mockReadMultipartFormData).not.toHaveBeenCalled();
    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 401);
  });

  it("preserves server errors from unexpected multipart body-read failures", async () => {
    mockReadRawBody.mockRejectedValueOnce(new Error("socket failed"));
    const event = {
      req: new Request("https://slides.example.test/api/assets/upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
        body: "--test--\r\n",
      }),
    };

    await expect(uploadVideoAssetHandler(event as never)).resolves.toEqual({
      error: "Video upload failed",
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 500);
  });

  it("preserves unexpected multipart parser TypeErrors as server errors", async () => {
    mockReadMultipartFormData.mockRejectedValueOnce(
      new TypeError("unexpected parser failure"),
    );
    const event = {
      req: new Request("https://slides.example.test/api/assets/upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
        body: "--test--\r\n",
      }),
    };

    await expect(uploadVideoAssetHandler(event as never)).resolves.toEqual({
      error: "Video upload failed",
    });

    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 500);
  });
});
