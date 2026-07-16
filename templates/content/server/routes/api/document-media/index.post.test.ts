import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const runWithRequestContext = vi.hoisted(() => vi.fn());
const assertAccess = vi.hoisted(() => vi.fn());
const putPrivateBlob = vi.hoisted(() => vi.fn());
const deletePrivateBlob = vi.hoisted(() => vi.fn());
const readMultipartFormData = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/private-blob", () => ({
  putPrivateBlob: (...args: unknown[]) => putPrivateBlob(...args),
  deletePrivateBlob: (...args: unknown[]) => deletePrivateBlob(...args),
}));
vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: () => "/content",
  getSession: (...args: unknown[]) => getSession(...args),
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => assertAccess(...args),
}));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("h3", () => ({
  createError: (value: Record<string, unknown>) =>
    Object.assign(new Error(), value),
  defineEventHandler: (handler: unknown) => handler,
  readMultipartFormData: (...args: unknown[]) => readMultipartFormData(...args),
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
    assertAccess.mockResolvedValue({
      resource: { ownerEmail: "owner@example.com", orgId: "org-1" },
    });
    putPrivateBlob.mockResolvedValue(opaqueHandle);
    deletePrivateBlob.mockResolvedValue(undefined);
    insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  });

  it("requires authentication and editor access before private storage", async () => {
    getSession.mockResolvedValue(null);
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(putPrivateBlob).not.toHaveBeenCalled();

    getSession.mockResolvedValue({
      email: "editor@example.com",
      orgId: "org-1",
    });
    assertAccess.mockRejectedValue(new Error("forbidden"));
    await expect(handler({} as never)).rejects.toThrow("forbidden");
    expect(putPrivateBlob).not.toHaveBeenCalled();
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
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    readMultipartFormData.mockResolvedValue(
      mediaParts("image/png", Buffer.alloc(25 * 1024 * 1024 + 1)),
    );
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    readMultipartFormData.mockResolvedValue(mediaParts());
    putPrivateBlob.mockResolvedValue(null);
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("compensates provider storage if the media row cannot be written", async () => {
    insert.mockReturnValue({
      values: vi.fn().mockRejectedValue(new Error("SQL failed")),
    });

    await expect(handler({} as never)).rejects.toThrow("SQL failed");
    expect(deletePrivateBlob).toHaveBeenCalledWith(opaqueHandle);
  });
});
