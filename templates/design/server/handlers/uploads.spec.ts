import fs from "fs";
import os from "os";
import path from "path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const uploadFileMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const objectStorageRequiredMock = vi.hoisted(() => vi.fn());
const readMultipartFormDataMock = vi.hoisted(() => vi.fn());
const setResponseStatusMock = vi.hoisted(() => vi.fn());

class StorageNotConfigured extends Error {
  readonly code = "file_upload_storage_not_configured";
}

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: uploadFileMock,
  isObjectStorageRequired: objectStorageRequiredMock,
  isFileUploadStorageNotConfiguredError: (err: unknown) =>
    (err as { code?: string })?.code === "file_upload_storage_not_configured",
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: getSessionMock,
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (fn: unknown) => fn,
  getRequestHeader: () => "0",
  readMultipartFormData: readMultipartFormDataMock,
  setResponseStatus: setResponseStatusMock,
}));

const { uploadFiles, uploadsRootForRuntime } = await import("./uploads.js");

function pngPart(name = "reference.png") {
  // Minimal PNG signature — the handler checks it before storing anything.
  const data = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.from("rest-of-file"),
  ]);
  return { name: "files", filename: name, type: "image/png", data };
}

describe("uploadsRootForRuntime", () => {
  it("uses the app data directory outside serverless", () => {
    expect(uploadsRootForRuntime("/repo/templates/design", {})).toBe(
      path.join("/repo/templates/design", "data", "uploads"),
    );
  });

  it("uses writable temp storage on serverless hosts", () => {
    expect(uploadsRootForRuntime("/var/task", { NETLIFY: "true" })).toBe(
      path.join(os.tmpdir(), "agent-native-design", "data", "uploads"),
    );
  });
});

describe("prompt-context uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ email: "user@example.com" });
    objectStorageRequiredMock.mockReturnValue(true);
    readMultipartFormDataMock.mockResolvedValue([pngPart()]);
  });

  it("returns the object-storage URL and writes nothing to disk", async () => {
    uploadFileMock.mockResolvedValue({
      url: "https://files.example.com/uploads/abc.png",
      id: "uploads/abc.png",
      provider: "cloudflare-r2",
    });
    const writeFile = vi.spyOn(fs.promises, "writeFile");

    const result = (await (uploadFiles as any)({})) as Array<
      Record<string, unknown>
    >;

    expect(result[0].path).toBe("https://files.example.com/uploads/abc.png");
    expect(result[0].originalName).toBe("reference.png");
    expect(writeFile).not.toHaveBeenCalled();
    writeFile.mockRestore();
  });

  it("fails closed with setup guidance rather than storing the payload", async () => {
    uploadFileMock.mockRejectedValue(
      new StorageNotConfigured("bind an R2 bucket"),
    );
    const writeFile = vi.spyOn(fs.promises, "writeFile");

    const result = (await (uploadFiles as any)({})) as Record<string, unknown>;

    expect(setResponseStatusMock).toHaveBeenCalledWith({}, 503);
    expect(result).toMatchObject({
      error: "bind an R2 bucket",
      storageSetupRequired: true,
    });
    expect(writeFile).not.toHaveBeenCalled();
    writeFile.mockRestore();
  });

  it("keeps the local directory on hosts that have one", async () => {
    objectStorageRequiredMock.mockReturnValue(false);
    const mkdir = vi
      .spyOn(fs.promises, "mkdir")
      .mockResolvedValue(undefined as never);
    const writeFile = vi
      .spyOn(fs.promises, "writeFile")
      .mockResolvedValue(undefined as never);

    const result = (await (uploadFiles as any)({})) as Array<
      Record<string, unknown>
    >;

    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
    expect(result[0].path).toMatch(/\.png$/);
    expect(result[0].path).not.toMatch(/^https?:/);
    expect(result[0]).not.toHaveProperty("_destPath");
    mkdir.mockRestore();
    writeFile.mockRestore();
  });
});
