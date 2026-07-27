import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActive: vi.fn(),
  list: vi.fn(),
  resolveHasBuilderPrivateKey: vi.fn(),
  builder: {
    id: "builder",
    name: "Builder.io",
    isConfigured: () => false,
    upload: vi.fn(),
    resumable: {},
  },
}));

vi.mock("@agent-native/core/file-upload", () => ({
  builderFileUploadProvider: mocks.builder,
  getActiveFileUploadProviderForRequest: (...args: unknown[]) =>
    mocks.getActive(...args),
  listFileUploadProviders: (...args: unknown[]) => mocks.list(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveHasBuilderPrivateKey: (...args: unknown[]) =>
    mocks.resolveHasBuilderPrivateKey(...args),
}));

import { resolveResumableUploadProvider } from "./resumable-upload-provider.js";

describe("resolveResumableUploadProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActive.mockResolvedValue(null);
    mocks.list.mockReturnValue([]);
    mocks.resolveHasBuilderPrivateKey.mockResolvedValue(false);
  });

  it("returns the request-scoped provider that owns the session", async () => {
    const s3 = {
      id: "s3",
      name: "S3",
      isConfigured: () => false,
      isConfiguredForRequest: vi.fn(async () => true),
      upload: vi.fn(),
      resumable: {},
    };
    mocks.getActive.mockResolvedValue(s3);

    await expect(resolveResumableUploadProvider("s3")).resolves.toBe(s3);
  });

  it("resolves a registered provider by id instead of switching sessions", async () => {
    const other = {
      id: "other",
      name: "Other",
      isConfigured: () => true,
      upload: vi.fn(),
      resumable: {},
    };
    const s3 = {
      id: "s3",
      name: "S3",
      isConfigured: () => false,
      isConfiguredForRequest: vi.fn(async () => true),
      upload: vi.fn(),
      resumable: {},
    };
    mocks.getActive.mockResolvedValue(other);
    mocks.list.mockReturnValue([other, s3]);

    await expect(resolveResumableUploadProvider("s3")).resolves.toBe(s3);
    expect(s3.isConfiguredForRequest).toHaveBeenCalledOnce();
  });

  it("resolves Builder sessions from request-scoped credentials", async () => {
    mocks.resolveHasBuilderPrivateKey.mockResolvedValue(true);

    await expect(resolveResumableUploadProvider("builder")).resolves.toBe(
      mocks.builder,
    );
  });
});
