import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const runWithRequestContext = vi.hoisted(() => vi.fn());
const assertAccess = vi.hoisted(() => vi.fn());
const putPrivateBlob = vi.hoisted(() => vi.fn());
const deletePrivateBlob = vi.hoisted(() => vi.fn());
const readMultipartFormData = vi.hoisted(() => vi.fn());
const getHeader = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: (...args: unknown[]) => putPrivateBlob(...args),
  deletePrivateBlob: (...args: unknown[]) => deletePrivateBlob(...args),
}));
vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: () => "/content",
  getSession: (...args: unknown[]) => getSession(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => assertAccess(...args),
}));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => getHeader(...args),
  readMultipartFormData: (...args: unknown[]) => readMultipartFormData(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../db/index.js", () => ({
  getDb: () => ({ insert }),
  schema: { documentMedia: {} },
}));

import handler from "./index.post";

const opaqueHandle = {
  id: "provider-secret-handle",
  provider: "vercel",
  opaque: true,
};

function mediaParts(type = "image/png", bytes = Buffer.from("bytes")) {
  return [
    { name: "documentId", data: Buffer.from("doc-1") },
    { name: "file", filename: "image.png", type, data: bytes },
  ];
}

describe("POST /api/document-media", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSession.mockResolvedValue({
      email: "editor@example.com",
      orgId: "org-1",
    });
    readMultipartFormData.mockResolvedValue(mediaParts());
    getHeader.mockImplementation((_event, name) =>
      name === "sec-fetch-site" ? "same-origin" : undefined,
    );
    assertAccess.mockResolvedValue({
      resource: { ownerEmail: "owner@example.com", orgId: "org-1" },
    });
    putPrivateBlob.mockResolvedValue(opaqueHandle);
    deletePrivateBlob.mockResolvedValue(undefined);
    insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  });

  it("requires authentication and editor access before private storage", async () => {
    getSession.mockResolvedValue(null);
    await expect(handler({} as never)).resolves.toMatchObject({
      error: "Unauthorized",
      code: "MEDIA_AUTH_REQUIRED",
      requestId: expect.any(String),
    });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 401);
    expect(putPrivateBlob).not.toHaveBeenCalled();
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "no-store",
    );

    getSession.mockResolvedValue({
      email: "editor@example.com",
      orgId: "org-1",
    });
    const accessErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    assertAccess.mockRejectedValue(
      Object.assign(new Error("forbidden"), { statusCode: 403 }),
    );
    await expect(handler({} as never)).resolves.toMatchObject({
      error: "Forbidden",
      code: "MEDIA_ACCESS_DENIED",
      requestId: expect.any(String),
    });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 403);
    expect(putPrivateBlob).not.toHaveBeenCalled();
    expect(assertAccess).toHaveBeenCalledWith("document", "doc-1", "editor", {
      userEmail: "editor@example.com",
      orgId: "org-1",
    });
    expect(accessErrorSpy).toHaveBeenCalledWith(
      "[content:document-media] upload failed",
      expect.objectContaining({ stage: "access", errorClass: "rejected" }),
    );
    accessErrorSpy.mockRestore();
  });

  it("requires the first-party CSRF marker before reading the session or multipart body", async () => {
    getHeader.mockReturnValue(undefined);

    await expect(handler({} as never)).resolves.toMatchObject({
      error: "Forbidden",
      code: "MEDIA_CSRF_REQUIRED",
      requestId: expect.any(String),
    });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 403);
    expect(getSession).not.toHaveBeenCalled();
    expect(readMultipartFormData).not.toHaveBeenCalled();
    expect(putPrivateBlob).not.toHaveBeenCalled();
  });

  it("accepts the explicit first-party CSRF marker when browser metadata is unavailable", async () => {
    getHeader.mockImplementation((_event, name) =>
      name === "x-agent-native-csrf" ? "1" : undefined,
    );

    await expect(handler({} as never)).resolves.toEqual({
      url: expect.stringMatching(/^\/content\/api\/document-media\//),
    });
  });

  it("accepts only capped media, stores an opaque handle, and returns only Content URL", async () => {
    const result = await handler({} as never);

    expect(putPrivateBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "image/png",
        metadata: { documentId: "doc-1" },
      }),
    );
    expect(insert).toHaveBeenCalled();
    const values = insert.mock.results[0]?.value.values.mock.calls[0]?.[0];
    expect(values.blobHandleJson).toContain("provider-secret-handle");
    expect(result).toEqual({
      url: expect.stringMatching(/^\/content\/api\/document-media\//),
    });
    expect(JSON.stringify(result)).not.toContain("provider-secret-handle");
    expect(JSON.stringify(result)).not.toContain("vercel");
  });

  it("rejects unsupported or oversized inputs and returns 503 when storage is missing", async () => {
    readMultipartFormData.mockResolvedValue(mediaParts("text/html"));
    await expect(handler({} as never)).resolves.toMatchObject({
      error: "Invalid media upload",
      code: "MEDIA_INVALID_UPLOAD",
    });
    readMultipartFormData.mockResolvedValue(mediaParts("image/svg+xml"));
    await expect(handler({} as never)).resolves.toMatchObject({
      error: "Invalid media upload",
      code: "MEDIA_INVALID_UPLOAD",
    });
    readMultipartFormData.mockResolvedValue(
      mediaParts("image/png", Buffer.alloc(25 * 1024 * 1024 + 1)),
    );
    await expect(handler({} as never)).resolves.toMatchObject({
      error: "Invalid media upload",
      code: "MEDIA_INVALID_UPLOAD",
    });
    readMultipartFormData.mockResolvedValue(mediaParts());
    putPrivateBlob.mockResolvedValue(null);
    await expect(handler({} as never)).resolves.toMatchObject({
      error: "Media upload unavailable",
      code: "MEDIA_STORAGE_UNAVAILABLE",
    });
  });

  it("maps provider rejection to a content-free 503 diagnostic instead of an authorization 403", async () => {
    const providerError = Object.assign(new Error("provider detail"), {
      statusCode: 403,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    putPrivateBlob.mockRejectedValue(providerError);

    await expect(handler({} as never)).resolves.toMatchObject({
      error: "Media upload unavailable",
      code: "MEDIA_STORAGE_UNAVAILABLE",
      requestId: expect.any(String),
    });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 503);
    expect(errorSpy).toHaveBeenCalledWith(
      "[content:document-media] upload failed",
      expect.objectContaining({
        requestId: expect.any(String),
        stage: "provider",
        errorClass: "rejected",
      }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
      "provider detail",
    );
    errorSpy.mockRestore();
  });

  it("compensates provider storage if the media row cannot be written", async () => {
    insert.mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("SQL failed")),
    });

    await expect(handler({} as never)).resolves.toMatchObject({
      error: "Media upload unavailable",
      code: "MEDIA_UPLOAD_FAILED",
    });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 500);
    expect(deletePrivateBlob).toHaveBeenCalledWith(opaqueHandle);
  });
});
