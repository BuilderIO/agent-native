import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  deleteBlob: vi.fn(),
  deleteSession: vi.fn(),
  getHeader: vi.fn(),
  getQuery: vi.fn(),
  getRouterParam: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
  putBlob: vi.fn(),
  readBody: vi.fn(),
  readBlob: vi.fn(),
  readRawBody: vi.fn(),
  saveFile: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (...args: unknown[]) => mocks.getHeader(...args),
  getQuery: (...args: unknown[]) => mocks.getQuery(...args),
  getRouterParam: (...args: unknown[]) => mocks.getRouterParam(...args),
  readBody: (...args: unknown[]) => mocks.readBody(...args),
  readRawBody: (...args: unknown[]) => mocks.readRawBody(...args),
  setResponseStatus: (...args: unknown[]) => mocks.setStatus(...args),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob: (...args: unknown[]) => mocks.deleteBlob(...args),
  putPrivateBlob: (...args: unknown[]) => mocks.putBlob(...args),
  readPrivateBlob: (...args: unknown[]) => mocks.readBlob(...args),
}));

vi.mock("../lib/chunked-upload-session.js", () => ({
  createChunkedUploadSession: (...args: unknown[]) =>
    mocks.createSession(...args),
  deleteChunkedUploadSession: (...args: unknown[]) =>
    mocks.deleteSession(...args),
  getChunkedUploadSession: (...args: unknown[]) => mocks.getSession(...args),
  listChunkedUploadSessions: (...args: unknown[]) =>
    mocks.listSessions(...args),
}));

vi.mock("./request-auth-context.js", () => ({
  resolveSlidesRequestAuth: vi.fn(async () => ({
    ok: true,
    context: { email: "owner@example.com", orgId: "org-1" },
  })),
  withSlidesRequestContext: vi.fn(
    async (
      _event: unknown,
      callback: (context: { orgId: string }) => unknown,
    ) => callback({ orgId: "org-1" }),
  ),
}));

vi.mock("./uploads.js", () => ({
  maxReferenceFileBytes: vi.fn(() => 50 * 1024 * 1024),
  saveUploadedReferenceFile: (...args: unknown[]) => mocks.saveFile(...args),
}));

import { uploadChunkedChunk } from "./uploads-chunked";

function session(overrides: Record<string, unknown> = {}) {
  return {
    filename: "deck.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    declaredSize: 8,
    chunks: {},
    chunkSizes: {},
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("chunked reference uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRouterParam.mockReturnValue("session-1");
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "0" });
    mocks.getHeader.mockReturnValue("4");
    mocks.getSession.mockResolvedValue(session());
    mocks.readRawBody.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    mocks.putBlob.mockResolvedValue({
      id: "blob-1",
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
    });
    mocks.deleteBlob.mockResolvedValue({
      deleted: true,
      provider: "public-upload:builder",
    });
  });

  it("rejects a missing Content-Length before buffering the body", async () => {
    mocks.getHeader.mockReturnValue(undefined);

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Valid Content-Length header required",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 411);
    expect(mocks.readRawBody).not.toHaveBeenCalled();
  });

  it("rejects cumulative bytes above declaredSize before storing a chunk", async () => {
    mocks.getSession.mockResolvedValue(
      session({ declaredSize: 5, chunkSizes: { "0": 4 } }),
    );
    mocks.getQuery.mockReturnValue({ index: "1", isFinal: "0" });

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Uploaded bytes exceed the declared file size",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 413);
    expect(mocks.readRawBody).not.toHaveBeenCalled();
    expect(mocks.putBlob).not.toHaveBeenCalled();
  });

  it("deletes an existing chunk before replacing its handle", async () => {
    const oldHandle = {
      id: "old",
      provider: "public-upload:builder",
      opaque: true,
      encrypted: true,
    };
    mocks.getSession.mockResolvedValue(
      session({ chunks: { "0": oldHandle }, chunkSizes: { "0": 4 } }),
    );

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      ok: true,
    });
    expect(mocks.deleteBlob).toHaveBeenCalledWith(oldHandle);
    expect(mocks.putBlob).toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        chunks: { "0": expect.objectContaining({ id: "blob-1" }) },
      }),
    );
  });

  it("rejects a final upload whose bytes do not equal declaredSize", async () => {
    mocks.getQuery.mockReturnValue({ index: "0", isFinal: "1" });

    await expect(uploadChunkedChunk({} as never)).resolves.toEqual({
      error: "Upload is incomplete or has an invalid size",
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.anything(), 400);
    expect(mocks.readBlob).not.toHaveBeenCalled();
  });
});
