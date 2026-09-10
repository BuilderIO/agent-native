import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock("./better-auth-instance.js", () => ({
  getBetterAuthInternalAdapter: async () => mocks,
}));

import { ensureCanonicalUserForLegacySession } from "./legacy-auth-migration.js";

describe("ensureCanonicalUserForLegacySession", () => {
  beforeEach(() => {
    mocks.findUserByEmail.mockReset();
    mocks.createUser.mockReset();
  });

  it("does not write when the canonical user already exists", async () => {
    mocks.findUserByEmail.mockResolvedValueOnce({
      user: { id: "user-1", email: "steve@builder.io" },
      accounts: [],
    });

    await expect(
      ensureCanonicalUserForLegacySession(" Steve@Builder.io "),
    ).resolves.toBe(false);

    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("creates only the canonical user for a missing legacy identity", async () => {
    mocks.findUserByEmail.mockResolvedValueOnce(null);
    mocks.createUser.mockResolvedValueOnce({ id: "user-1" });

    await expect(
      ensureCanonicalUserForLegacySession(" Steve@Builder.io "),
    ).resolves.toBe(true);

    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "steve@builder.io",
      name: "steve",
      emailVerified: true,
    });
  });

  it("accepts a concurrent creator after re-reading the adapter", async () => {
    mocks.findUserByEmail.mockResolvedValueOnce(null).mockResolvedValueOnce({
      user: { id: "user-1", email: "steve@builder.io" },
      accounts: [],
    });
    mocks.createUser.mockRejectedValueOnce(new Error("duplicate email"));

    await expect(
      ensureCanonicalUserForLegacySession("steve@builder.io"),
    ).resolves.toBe(false);
  });
});
