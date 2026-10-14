import { beforeEach, describe, expect, it, vi } from "vitest";

const refs = vi.hoisted(() => ({
  context: undefined as Record<string, unknown> | undefined,
  resolveOrg: vi.fn(),
  storageReadiness: vi.fn(),
  builderAuthorized: vi.fn(),
  encryptionReady: vi.fn(),
}));

vi.mock("../org/index.js", () => ({
  resolveActiveOrgIdForStorageCredential: (...args: unknown[]) =>
    refs.resolveOrg(...args),
}));

vi.mock("../private-blob/registry.js", () => ({
  getPrivateBlobStorageReadinessForRequest: (...args: unknown[]) =>
    refs.storageReadiness(...args),
}));

vi.mock("../private-blob/attachment-ref.js", () => ({
  isAttachmentEncryptionKeyAvailable: (...args: unknown[]) =>
    refs.encryptionReady(...args),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestBuilderStorageCredentialOrgId: () =>
    refs.context?.builderStorageCredentialOrgId,
  getRequestContext: () => refs.context,
  runWithRequestContext: async (
    context: Record<string, unknown>,
    callback: () => unknown,
  ) => {
    const previous = refs.context;
    refs.context = context;
    try {
      return await callback();
    } finally {
      refs.context = previous;
    }
  },
}));

vi.mock("../server/builder-api-auth.js", () => ({
  canAuthorizeBuilderApiRequest: (...args: unknown[]) =>
    refs.builderAuthorized(...args),
}));

vi.mock("../server/builder-oauth.js", () => ({
  BUILDER_ASSETS_WRITE_SCOPE: "builder:assets:write",
}));

import {
  getPrivateStorageReadinessForRequest,
  getPrivateStorageReadinessForUser,
} from "./storage-readiness.js";

describe("private storage readiness", () => {
  beforeEach(() => {
    refs.context = undefined;
    refs.resolveOrg.mockReset().mockResolvedValue("org-selected");
    refs.storageReadiness.mockReset().mockResolvedValue({
      configured: true,
      providerId: "builder",
    });
    refs.builderAuthorized.mockReset().mockResolvedValue(true);
    refs.encryptionReady.mockReset().mockReturnValue(true);
  });

  it("probes storage using the caller's strict selected-org context", async () => {
    await expect(
      getPrivateStorageReadinessForUser("ada@example.test"),
    ).resolves.toEqual({
      selectedOrg: "selected",
      provider: "builder",
      readiness: "ready",
      builderAuthorized: "yes",
    });
    expect(refs.resolveOrg).toHaveBeenCalledWith("ada@example.test");
    expect(refs.storageReadiness).toHaveBeenCalledOnce();
    expect(refs.builderAuthorized).toHaveBeenCalledWith("builder:assets:write");
    expect(refs.context).toBeUndefined();
  });

  it("represents explicit Personal selection and absent storage separately", async () => {
    refs.resolveOrg.mockResolvedValueOnce(null);
    refs.storageReadiness.mockResolvedValueOnce({
      configured: false,
      providerId: null,
    });
    refs.builderAuthorized.mockResolvedValueOnce(false);

    await expect(
      getPrivateStorageReadinessForUser("ada@example.test"),
    ).resolves.toEqual({
      selectedOrg: "none",
      provider: "none",
      readiness: "unavailable",
      builderAuthorized: "no",
    });
  });

  it("does not report a failed membership read as no selected org", async () => {
    refs.resolveOrg.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      getPrivateStorageReadinessForUser("ada@example.test"),
    ).resolves.toEqual({
      selectedOrg: "unavailable",
      provider: "unavailable",
      readiness: "unavailable",
      builderAuthorized: "unavailable",
    });
    expect(refs.storageReadiness).not.toHaveBeenCalled();
  });

  it("does not expose provider errors or collapse them into readiness", async () => {
    refs.storageReadiness.mockRejectedValueOnce(
      new Error("private provider unavailable"),
    );
    refs.builderAuthorized.mockRejectedValueOnce(
      new Error("credential store unavailable"),
    );

    await expect(
      getPrivateStorageReadinessForUser("ada@example.test"),
    ).resolves.toEqual({
      selectedOrg: "selected",
      provider: "unavailable",
      readiness: "unavailable",
      builderAuthorized: "unavailable",
    });
  });

  it("requires the same attachment encryption key used by minting", async () => {
    refs.encryptionReady.mockReturnValueOnce(false);

    await expect(
      getPrivateStorageReadinessForUser("ada@example.test"),
    ).resolves.toEqual({
      selectedOrg: "selected",
      provider: "builder",
      readiness: "unavailable",
      builderAuthorized: "yes",
    });
  });

  it("requires an explicitly established personal storage context", async () => {
    refs.context = {
      userEmail: "ada@example.test",
      orgId: "org-selected",
      builderStorageCredentialOrgId: "org-selected",
    };

    await expect(getPrivateStorageReadinessForRequest()).resolves.toEqual({
      selectedOrg: "unavailable",
      provider: "unavailable",
      readiness: "unavailable",
      builderAuthorized: "unavailable",
    });
    expect(refs.storageReadiness).not.toHaveBeenCalled();
    expect(refs.builderAuthorized).not.toHaveBeenCalled();
  });
});
