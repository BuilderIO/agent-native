import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeProvider: null as { id: string } | null,
  hasBuilderApiCredentialCustody: vi.fn(),
}));

const CredentialStoreUnavailableErrorMock = vi.hoisted(
  () =>
    class CredentialStoreUnavailableError extends Error {
      readonly errorCode = "credential_store_unavailable";
    },
);

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProvider: () => mocks.activeProvider,
  uploadFile: vi.fn(),
}));
vi.mock("@agent-native/core/server", () => ({
  CredentialStoreUnavailableError: CredentialStoreUnavailableErrorMock,
  hasBuilderApiCredentialCustody: mocks.hasBuilderApiCredentialCustody,
}));
vi.mock("./s3-upload-provider.js", () => ({
  getPresignedS3ObjectUrl: vi.fn(),
  getS3Object: vi.fn(),
  isS3StorageKey: vi.fn(),
  s3StorageKey: vi.fn(),
}));

import { isObjectStorageConfigured } from "./storage.js";

describe("isObjectStorageConfigured", () => {
  beforeEach(() => {
    mocks.activeProvider = null;
    mocks.hasBuilderApiCredentialCustody.mockReset();
  });

  it("propagates a temporary credential-store failure", async () => {
    mocks.hasBuilderApiCredentialCustody.mockRejectedValue(
      new CredentialStoreUnavailableErrorMock(),
    );

    await expect(isObjectStorageConfigured()).rejects.toBeInstanceOf(
      CredentialStoreUnavailableErrorMock,
    );
  });

  it("reports false when Builder custody is absent", async () => {
    mocks.hasBuilderApiCredentialCustody.mockResolvedValue(false);

    await expect(isObjectStorageConfigured()).resolves.toBe(false);
  });
});
