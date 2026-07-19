import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  authSource: vi.fn(),
  userId: vi.fn(),
  email: vi.fn(),
  orgId: vi.fn(),
}));
const isEnabled = vi.hoisted(() => vi.fn());
const resolveScope = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestAuthSource: () => request.authSource(),
  getRequestStableUserId: () => request.userId(),
  getRequestUserEmail: () => request.email(),
  getRequestOrgId: () => request.orgId(),
}));
vi.mock("@agent-native/core/feature-flags", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/feature-flags")
  >()),
  isFeatureFlagEnabled: (...args: unknown[]) => isEnabled(...args),
}));
vi.mock("./private-vault-genesis-account-scope.js", () => ({
  resolvePrivateVaultScopeForStableIdentity: (...args: unknown[]) =>
    resolveScope(...args),
}));

import { CONTENT_PRIVATE_VAULT_ACCESS_FLAG } from "../../shared/private-vault-feature-flags.js";
import {
  PrivateVaultObjectNotFoundError,
  requirePrivateVaultActionScope,
} from "./private-vault-objects.js";

describe("Private Vault action scope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    request.authSource.mockReturnValue("better-auth");
    request.userId.mockReturnValue("user:test");
    request.email.mockReturnValue("Owner@Example.test");
    request.orgId.mockReturnValue("org:test");
    isEnabled.mockResolvedValue(true);
    resolveScope.mockResolvedValue({
      ownerEmail: "owner@example.test",
      orgId: "org:test",
      vaultId: "21".repeat(16),
    });
  });

  it("requires the access flag on the action route as well as custom routes", async () => {
    isEnabled.mockResolvedValue(false);
    await expect(
      requirePrivateVaultActionScope("21".repeat(16)),
    ).rejects.toBeInstanceOf(PrivateVaultObjectNotFoundError);
    expect(isEnabled).toHaveBeenCalledWith(CONTENT_PRIVATE_VAULT_ACCESS_FLAG, {
      userEmail: "owner@example.test",
      userKey: "user:test",
      orgId: "org:test",
    });
    expect(resolveScope).not.toHaveBeenCalled();
  });

  it("resolves the exact stable account only after the access gate passes", async () => {
    await expect(
      requirePrivateVaultActionScope("21".repeat(16)),
    ).resolves.toMatchObject({ ownerEmail: "owner@example.test" });
    expect(resolveScope).toHaveBeenCalledWith({
      userId: "user:test",
      email: "Owner@Example.test",
      orgId: "org:test",
      vaultId: "21".repeat(16),
    });
  });
});
