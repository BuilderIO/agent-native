import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The dev-only local fallback writes asset bytes to the app's data folder, so
// it reports the write before creating the folder or the file. Production
// refuses before that point and reports nothing.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
  uploadFile: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  hasBuilderApiCredentialCustody: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mocks.uploadFile,
  getActiveFileUploadProvider: () => null,
}));

vi.mock("@agent-native/core/server", () => ({
  CredentialStoreUnavailableError: class extends Error {},
  hasBuilderApiCredentialCustody: mocks.hasBuilderApiCredentialCustody,
}));

vi.mock("./s3-upload-provider.js", () => ({
  getPresignedS3ObjectUrl: vi.fn(),
  getS3Object: vi.fn(),
  isS3StorageKey: vi.fn(),
  s3StorageKey: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const writes = { mkdir: mocks.mkdir, writeFile: mocks.writeFile };
  return { ...actual, ...writes, default: { ...actual, ...writes } };
});

const { putObject } = await import("./storage.js");

const body = Buffer.from("png-bytes");

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.uploadFile.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("putObject local fallback writes", () => {
  it("notes a local-disk write before the folder and file are created", async () => {
    const stored = await putObject({
      key: "library/hero.png",
      body,
      contentType: "image/png",
    });

    expect(stored).toEqual({ key: "local:library/hero.png" });
    expect(mocks.mkdir).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).toHaveBeenCalledWith(
      path.join(process.cwd(), "data", "assets-objects", "library", "hero.png"),
      body,
    );
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    expect(mocks.noteExternalWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mkdir.mock.invocationCallOrder[0],
    );
    expect(mocks.noteExternalWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.writeFile.mock.invocationCallOrder[0],
    );
  });

  it("refuses in production before any note or write", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(
      putObject({ key: "library/hero.png", body, contentType: "image/png" }),
    ).rejects.toThrow("Asset storage is not configured");

    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
