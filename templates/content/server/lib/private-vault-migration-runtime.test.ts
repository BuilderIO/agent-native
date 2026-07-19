import { beforeEach, describe, expect, it, vi } from "vitest";

const isEnabled = vi.hoisted(() => vi.fn());
const requireActionScope = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => ({ userId: vi.fn(), orgId: vi.fn() }));

vi.mock("@agent-native/core/feature-flags", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/feature-flags")
  >()),
  isFeatureFlagEnabled: (...args: unknown[]) => isEnabled(...args),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestStableUserId: () => request.userId(),
  getRequestOrgId: () => request.orgId(),
}));
vi.mock("./private-vault-objects.js", () => {
  class PrivateVaultObjectNotFoundError extends Error {}
  return {
    PrivateVaultObjectNotFoundError,
    requirePrivateVaultActionScope: (...args: unknown[]) =>
      requireActionScope(...args),
  };
});
vi.mock("./private-vault-migration-source.js", () => ({
  sqlPrivateVaultMigrationSource: {},
}));
vi.mock("./private-vault-migration-store.js", () => ({
  sqlPrivateVaultMigrationStore: { get: vi.fn() },
}));
vi.mock("./private-vault-migration-target.js", () => ({
  privateVaultMigrationCiphertextTarget: {},
}));

import { CONTENT_PRIVATE_VAULT_MIGRATION_FLAG } from "../../shared/private-vault-feature-flags.js";
import { requirePrivateVaultMigrationActionScope } from "./private-vault-migration-runtime.js";

describe("Private Vault migration action scope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    request.userId.mockReturnValue("user:test");
    request.orgId.mockReturnValue("org:test");
    requireActionScope.mockResolvedValue({
      ownerEmail: "owner@example.test",
      orgId: "org:test",
      vaultId: "21".repeat(16),
    });
    isEnabled.mockResolvedValue(true);
  });

  it("requires the separate exact-account migration flag", async () => {
    isEnabled.mockResolvedValue(false);
    await expect(
      requirePrivateVaultMigrationActionScope("21".repeat(16)),
    ).rejects.toThrow();
    expect(isEnabled).toHaveBeenCalledWith(
      CONTENT_PRIVATE_VAULT_MIGRATION_FLAG,
      {
        userEmail: "owner@example.test",
        userKey: "user:test",
        orgId: "org:test",
      },
    );
  });

  it("returns the already access-checked active vault scope when enabled", async () => {
    await expect(
      requirePrivateVaultMigrationActionScope("21".repeat(16)),
    ).resolves.toMatchObject({
      ownerEmail: "owner@example.test",
      vaultId: "21".repeat(16),
    });
  });
});
