import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasBuilderApiCredentialCustody: vi.fn(),
  providers: [] as Array<{ id: string; isConfigured: () => boolean }>,
}));

const CredentialStoreUnavailableErrorMock = vi.hoisted(
  () =>
    class CredentialStoreUnavailableError extends Error {
      readonly errorCode = "credential_store_unavailable";
    },
);

vi.mock("@agent-native/core/file-upload", () => ({
  listFileUploadProviders: () => mocks.providers,
}));
vi.mock("@agent-native/core/server", () => ({
  CredentialStoreUnavailableError: CredentialStoreUnavailableErrorMock,
  hasBuilderApiCredentialCustody: mocks.hasBuilderApiCredentialCustody,
  runWithRequestContext: async (_context: unknown, run: () => unknown) => run(),
}));

import { hasRequestReplayStorage } from "./replay-storage.js";

describe("hasRequestReplayStorage", () => {
  beforeEach(() => {
    mocks.providers = [];
    mocks.hasBuilderApiCredentialCustody.mockReset();
  });

  it("propagates a temporary credential-store failure", async () => {
    mocks.hasBuilderApiCredentialCustody.mockRejectedValue(
      new CredentialStoreUnavailableErrorMock(),
    );

    await expect(hasRequestReplayStorage()).rejects.toBeInstanceOf(
      CredentialStoreUnavailableErrorMock,
    );
  });

  it("reports false when Builder custody is absent", async () => {
    mocks.hasBuilderApiCredentialCustody.mockResolvedValue(false);

    await expect(hasRequestReplayStorage()).resolves.toBe(false);
  });
});
