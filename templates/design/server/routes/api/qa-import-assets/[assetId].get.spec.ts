import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateReadStream = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockStreamFile = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockIsEnabled = vi.hoisted(() => vi.fn());
const mockMimeType = vi.hoisted(() => vi.fn());
const mockAssetPaths = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
}));

vi.mock("node:fs/promises", () => ({
  stat: (...args: unknown[]) => mockStat(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  streamFile: (...args: unknown[]) => mockStreamFile(...args),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (...args: unknown[]) => mockGetRouterParam(...args),
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../../lib/local-import-asset-upload.js", () => ({
  isLocalImportAssetUploadEnabled: (...args: unknown[]) =>
    mockIsEnabled(...args),
  localImportAssetAssetMimeType: (...args: unknown[]) => mockMimeType(...args),
  localImportAssetAssetPaths: (...args: unknown[]) => mockAssetPaths(...args),
}));

import handler from "./[assetId].get.js";

function makeEvent(assetId = "0f0f0f0f-1111-4222-8333-444444444444.png") {
  const headers = new Map<string, string>();
  return {
    assetId,
    status: 200,
    headers,
    node: {
      res: {
        setHeader: (name: string, value: string) => headers.set(name, value),
      },
    },
  };
}

function missingFileError(): NodeJS.ErrnoException {
  return Object.assign(new Error("not found"), { code: "ENOENT" });
}

describe("GET /api/qa-import-assets/:assetId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled.mockReturnValue(true);
    mockGetRouterParam.mockImplementation(
      (event: { assetId?: string }) => event.assetId,
    );
    mockSetResponseHeader.mockImplementation(
      (
        event: { headers: Map<string, string> },
        name: string,
        value: string,
      ) => {
        event.headers.set(name, value);
      },
    );
    mockSetResponseStatus.mockImplementation(
      (event: { status: number }, status: number) => {
        event.status = status;
      },
    );
    mockGetSession.mockResolvedValue({ email: "qa-owner@example.test" });
    mockAssetPaths.mockReturnValue([
      "/private/qa-owner/0f0f0f0f-1111-4222-8333-444444444444.png",
    ]);
    mockMimeType.mockReturnValue("image/png");
    mockStat.mockResolvedValue({ isFile: () => true });
    mockCreateReadStream.mockReturnValue({ kind: "read-stream" });
    mockStreamFile.mockReturnValue({ kind: "stream-response" });
  });

  it("is unavailable in production or whenever the QA provider is disabled", async () => {
    mockIsEnabled.mockReturnValue(false);
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Not found",
    });

    expect(event.status).toBe(404);
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockAssetPaths).not.toHaveBeenCalled();
  });

  it("requires an authenticated request before resolving an asset path", async () => {
    mockGetSession.mockResolvedValue(null);
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Unauthorized",
    });

    expect(event.status).toBe(401);
    expect(mockAssetPaths).not.toHaveBeenCalled();
  });

  it("treats a session lookup failure as unauthenticated, preserving the existing route response", async () => {
    mockGetSession.mockRejectedValue(new Error("session store unavailable"));
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Unauthorized",
    });

    expect(event.status).toBe(401);
    expect(mockAssetPaths).not.toHaveBeenCalled();
  });

  it("resolves assets only inside the authenticated owner's directory", async () => {
    mockGetSession.mockResolvedValue({ email: "other-owner@example.test" });
    mockAssetPaths.mockReturnValue([
      "/private/other-owner/0f0f0f0f-1111-4222-8333-444444444444.png",
    ]);
    mockStat.mockRejectedValue(missingFileError());
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Not found",
    });

    expect(event.status).toBe(404);
    expect(mockAssetPaths).toHaveBeenCalledWith(
      "other-owner@example.test",
      event.assetId,
    );
    expect(mockStreamFile).not.toHaveBeenCalled();
  });

  it("rejects traversal and malformed asset ids before touching the filesystem", async () => {
    const event = makeEvent("../private.png");
    mockAssetPaths.mockReturnValue([]);
    mockMimeType.mockReturnValue(null);

    await expect(handler(event as never)).resolves.toEqual({
      error: "Invalid asset id",
    });

    expect(event.status).toBe(400);
    expect(mockStat).not.toHaveBeenCalled();
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it("streams a valid owner-scoped asset with private, nosniff headers", async () => {
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      kind: "stream-response",
    });

    expect(event.status).toBe(200);
    expect(event.headers.get("Content-Type")).toBe("image/png");
    expect(event.headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(event.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mockCreateReadStream).toHaveBeenCalledWith(
      "/private/qa-owner/0f0f0f0f-1111-4222-8333-444444444444.png",
    );
    expect(mockStreamFile).toHaveBeenCalledWith({ kind: "read-stream" });
  });

  it("returns not found when no saved asset path can be read", async () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    mockStat.mockRejectedValue(error);
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Not found",
    });

    expect(event.status).toBe(404);
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it("streams a valid owner-scoped SVG with its image MIME type", async () => {
    const event = makeEvent("0f0f0f0f-1111-4222-8333-444444444444.svg");
    mockAssetPaths.mockReturnValue([
      "/private/qa-owner/0f0f0f0f-1111-4222-8333-444444444444.svg",
    ]);
    mockMimeType.mockReturnValue("image/svg+xml");

    await expect(handler(event as never)).resolves.toEqual({
      kind: "stream-response",
    });

    expect(event.status).toBe(200);
    expect(event.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(event.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; sandbox",
    );
    expect(event.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mockCreateReadStream).toHaveBeenCalledWith(
      "/private/qa-owner/0f0f0f0f-1111-4222-8333-444444444444.svg",
    );
  });

  it("falls back to the previous local cache path for a saved asset", async () => {
    const currentPath = "/private/new/0f0f0f0f-1111-4222-8333-444444444444.png";
    const previousPath =
      "/private/old/0f0f0f0f-1111-4222-8333-444444444444.png";
    mockAssetPaths.mockReturnValue([currentPath, previousPath]);
    mockStat
      .mockRejectedValueOnce(missingFileError())
      .mockResolvedValueOnce({ isFile: () => true });

    await expect(handler(makeEvent() as never)).resolves.toEqual({
      kind: "stream-response",
    });

    expect(mockCreateReadStream).toHaveBeenCalledWith(previousPath);
  });
});
