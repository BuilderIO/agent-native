import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockReadUploadedReferenceBlob = vi.hoisted(() => vi.fn());

vi.mock("fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    promises: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
    },
  },
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("../server/lib/tenant-files.js", () => ({
  tenantUploadDir: () => "/uploads/owner",
}));

vi.mock("../server/lib/uploaded-reference-storage.js", () => ({
  readUploadedReferenceBlob: (...args: unknown[]) =>
    mockReadUploadedReferenceBlob(...args),
}));

import { readUserUploadedFile } from "./_uploaded-files";

describe("readUserUploadedFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadUploadedReferenceBlob.mockResolvedValue(null);
  });

  it("returns durable hosted upload bytes without touching local files", async () => {
    mockReadUploadedReferenceBlob.mockResolvedValue({
      data: Buffer.from("pptx"),
      filename: "deck.pptx",
    });

    await expect(
      readUserUploadedFile("slides-upload:v1:opaque"),
    ).resolves.toEqual({ data: Buffer.from("pptx"), filename: "deck.pptx" });
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it("reads an authenticated user's local upload", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(Buffer.from("local"));

    await expect(
      readUserUploadedFile("/uploads/owner/deck.pptx"),
    ).resolves.toEqual({ data: Buffer.from("local"), filename: "deck.pptx" });
  });

  it("rejects local path traversal before reading", async () => {
    await expect(
      readUserUploadedFile("/uploads/other/deck.pptx"),
    ).rejects.toThrow("Access denied");
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
