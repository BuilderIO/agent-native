import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getOrgContext = vi.hoisted(() => vi.fn());
const isEnabled = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  getCurrentBetterAuthSession: (...args: unknown[]) => getSession(...args),
}));
vi.mock("@agent-native/core/org", () => ({
  getOrgContext: (...args: unknown[]) => getOrgContext(...args),
}));
vi.mock("@agent-native/core/feature-flags", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/feature-flags")
  >()),
  isFeatureFlagEnabled: (...args: unknown[]) => isEnabled(...args),
}));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestURL: (event: { path: string }) =>
    new URL(event.path, "https://content.example.test"),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));

import {
  CONTENT_PRIVATE_VAULT_ACCESS_FLAG,
  CONTENT_PRIVATE_VAULT_ENROLLMENT_FLAG,
  CONTENT_PRIVATE_VAULT_MIGRATION_FLAG,
} from "../../shared/private-vault-feature-flags.js";
import handler from "./private-vault-feature-gate.js";

describe("Private Vault feature gate middleware", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSession.mockResolvedValue({
      email: "Owner@Example.com",
      userId: "user:test",
    });
    getOrgContext.mockResolvedValue({
      email: "owner@example.com",
      orgId: "org:test",
    });
    isEnabled.mockResolvedValue(true);
  });

  it("fails an authenticated Private Vault request closed when access is off", async () => {
    isEnabled.mockResolvedValue(false);
    await expect(
      handler({ path: "/api/private-vault/runtime" } as never),
    ).resolves.toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(isEnabled).toHaveBeenCalledWith(CONTENT_PRIVATE_VAULT_ACCESS_FLAG, {
      userEmail: "owner@example.com",
      userKey: "user:test",
      orgId: "org:test",
    });
  });

  it("requires the separate enrollment flag for genesis and enrollment", async () => {
    isEnabled.mockImplementation(
      async (flag: { key: string }) =>
        flag.key === CONTENT_PRIVATE_VAULT_ACCESS_FLAG.key,
    );
    await expect(
      handler({ path: "/api/private-vault/genesis/challenge" } as never),
    ).resolves.toEqual({ error: "Not found" });
    expect(isEnabled).toHaveBeenNthCalledWith(
      2,
      CONTENT_PRIVATE_VAULT_ENROLLMENT_FLAG,
      expect.objectContaining({ userKey: "user:test" }),
    );
  });

  it("requires the separate migration flag for every migration route", async () => {
    isEnabled.mockImplementation(
      async (flag: { key: string }) =>
        flag.key === CONTENT_PRIVATE_VAULT_ACCESS_FLAG.key,
    );
    await expect(
      handler({ path: "/api/private-vault/migration/preflight" } as never),
    ).resolves.toEqual({ error: "Not found" });
    expect(isEnabled).toHaveBeenCalledWith(
      CONTENT_PRIVATE_VAULT_MIGRATION_FLAG,
      expect.objectContaining({ userKey: "user:test", orgId: "org:test" }),
    );
  });

  it("does not pre-authorize anonymous signed or platform traffic", async () => {
    getSession.mockResolvedValue(null);
    await expect(
      handler({ path: "/api/private-vault/broker/claim" } as never),
    ).resolves.toBeUndefined();
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it("ignores unrelated app routes", async () => {
    await expect(
      handler({ path: "/api/documents" } as never),
    ).resolves.toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
  });
});
