import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateReadStream = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());
const mockGetSession = vi.hoisted(() => vi.fn());
const mockStreamFile = vi.hoisted(() => vi.fn());
const mockGetRouterParam = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockIsEnabled = vi.hoisted(() => vi.fn());
const mockMimeType = vi.hoisted(() => vi.fn());
const mockAssetPath = vi.hoisted(() => vi.fn());

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
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../../lib/local-figma-qa-upload.js", () => ({
  isLocalFigmaQaUploadEnabled: (...args: unknown[]) => mockIsEnabled(...args),
  localFigmaQaAssetMimeType: (...args: unknown[]) => mockMimeType(...args),
  localFigmaQaAssetPath: (...args: unknown[]) => mockAssetPath(...args),
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

describe("GET /api/qa-figma-import-assets/:assetId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled.mockReturnValue(true);
    mockGetRouterParam.mockImplementation(
      (event: { assetId?: string }) => event.assetId,
    );
    mockSetResponseStatus.mockImplementation(
      (event: { status: number }, status: number) => {
        event.status = status;
      },
    );
    mockGetSession.mockResolvedValue({ email: "qa-owner@example.test" });
    mockAssetPath.mockReturnValue(
      "/private/qa-owner/0f0f0f0f-1111-4222-8333-444444444444.png",
    );
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
    expect(mockAssetPath).not.toHaveBeenCalled();
  });

  it("requires an authenticated request before resolving an asset path", async () => {
    mockGetSession.mockResolvedValue(null);
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Unauthorized",
    });

    expect(event.status).toBe(401);
    expect(mockAssetPath).not.toHaveBeenCalled();
  });

  it("resolves assets only inside the authenticated owner's directory", async () => {
    mockGetSession.mockResolvedValue({ email: "other-owner@example.test" });
    mockAssetPath.mockReturnValue(
      "/private/other-owner/0f0f0f0f-1111-4222-8333-444444444444.png",
    );
    mockStat.mockRejectedValue(new Error("not found in this owner's scope"));
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Not found",
    });

    expect(event.status).toBe(404);
    expect(mockAssetPath).toHaveBeenCalledWith(
      "other-owner@example.test",
      event.assetId,
    );
    expect(mockStreamFile).not.toHaveBeenCalled();
  });

  it("rejects traversal and malformed asset ids before touching the filesystem", async () => {
    const event = makeEvent("../private.png");
    mockAssetPath.mockReturnValue(null);
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
});
