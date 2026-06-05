import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMaxFigBytes = vi.hoisted(() => 200 * 1024 * 1024);
const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetRequestHeader = vi.hoisted(() => vi.fn());
const mockReadMultipartFormData = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockParseSlidesFigDesignSystem = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader: (...args: unknown[]) => mockGetRequestHeader(...args),
  readMultipartFormData: (...args: unknown[]) =>
    mockReadMultipartFormData(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock("../lib/fig-design-system.js", () => ({
  MAX_FIG_BYTES: mockMaxFigBytes,
  parseSlidesFigDesignSystem: (...args: unknown[]) =>
    mockParseSlidesFigDesignSystem(...args),
}));

import { importFigmaSystem } from "./import-figma-system";

describe("importFigmaSystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ email: "owner@example.com" });
    mockGetRequestHeader.mockReturnValue(null);
    mockReadMultipartFormData.mockResolvedValue([
      {
        name: "file",
        filename: "brand.fig",
        data: Buffer.from("fig-kiwi\0\0\0\0"),
      },
    ]);
    mockParseSlidesFigDesignSystem.mockReturnValue({
      ok: true,
      suggestedTitle: "brand",
    });
  });

  it("rejects oversized requests before multipart parsing", async () => {
    mockGetRequestHeader.mockReturnValue(
      String(mockMaxFigBytes + 1024 * 1024 + 1),
    );

    const result = await importFigmaSystem({} as any);

    expect(mockReadMultipartFormData).not.toHaveBeenCalled();
    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 413);
    expect(result).toEqual({ error: "File too large (max 200 MB)." });
  });

  it("returns a clear error when multipart parsing fails", async () => {
    mockReadMultipartFormData.mockRejectedValue(new Error("bad multipart"));

    const result = await importFigmaSystem({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 413);
    expect(result).toEqual({ error: "Upload too large or malformed." });
  });

  it("passes uploaded fig bytes to the parser", async () => {
    const data = Buffer.from("fig-kiwi\0\0\0\0");
    mockReadMultipartFormData.mockResolvedValue([
      { name: "fig", filename: "brand.fig", data },
    ]);

    const result = await importFigmaSystem({} as any);

    expect(mockParseSlidesFigDesignSystem).toHaveBeenCalledWith({
      data,
      filename: "brand.fig",
    });
    expect(result).toEqual({ ok: true, suggestedTitle: "brand" });
  });

  it("returns parser errors as invalid fig responses", async () => {
    mockParseSlidesFigDesignSystem.mockImplementation(() => {
      throw new Error("That doesn't look like a Figma .fig file.");
    });

    const result = await importFigmaSystem({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith(expect.anything(), 422);
    expect(result).toEqual({
      error: "That doesn't look like a Figma .fig file.",
    });
  });
});
