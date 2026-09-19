import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute }),
}));

import {
  getAuthEmailForUserId,
  getRequiredAuthProviderForEmail,
  isGoogleSignInRequiredForEmail,
  setRequiredAuthProvider,
} from "./auth-policy.js";

describe("organization auth policy", () => {
  beforeEach(() => execute.mockReset());

  it("matches members, pending invites, and allowed domains", async () => {
    execute.mockResolvedValueOnce({ rows: [{ provider: "google" }] });

    await expect(
      getRequiredAuthProviderForEmail("Person@Builder.IO"),
    ).resolves.toBe("google");

    expect(execute).toHaveBeenCalledWith({
      sql: expect.stringContaining("org_invitations"),
      args: ["person@builder.io", "person@builder.io", "builder.io"],
    });
  });

  it("returns no requirement when no matching organization exists", async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await expect(
      isGoogleSignInRequiredForEmail("person@example.com"),
    ).resolves.toBe(false);
  });

  it("reads a user from Better Auth's transaction adapter before the global DB", async () => {
    const findUserById = vi.fn().mockResolvedValue({
      id: "new-user",
      email: "new@example.com",
    });

    await expect(
      getAuthEmailForUserId("new-user", { findUserById }),
    ).resolves.toBe("new@example.com");
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps missing user rows as an error when the transaction lookup is empty", async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await expect(
      getAuthEmailForUserId("missing-user", {
        findUserById: vi.fn().mockResolvedValue(null),
      }),
    ).rejects.toThrow("Better Auth user email not found: missing-user");
  });

  it("resolves an organization-specific SSO provider requirement", async () => {
    execute.mockResolvedValueOnce({ rows: [{ provider: "sso:okta" }] });

    await expect(
      getRequiredAuthProviderForEmail("person@example.com"),
    ).resolves.toBe("sso:okta");
  });

  it("requires the shared provider when multiple organizations agree", async () => {
    execute.mockResolvedValueOnce({
      rows: [{ provider: "google" }, { provider: "google" }],
    });

    await expect(
      getRequiredAuthProviderForEmail("person@example.com"),
    ).resolves.toBe("google");
    expect(execute.mock.calls[0][0].sql).not.toContain("LIMIT 1");
  });

  it("fails closed when multiple organizations require different providers", async () => {
    execute.mockResolvedValueOnce({
      rows: [{ provider: "google" }, { provider: "sso:okta" }],
    });

    await expect(
      getRequiredAuthProviderForEmail("person@example.com"),
    ).resolves.toBe("conflict");
  });

  it("revokes both auth stores when Google sign-in is enabled", async () => {
    execute
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 4 })
      .mockResolvedValueOnce({ rowsAffected: 3 });

    await expect(setRequiredAuthProvider("builder", "google")).resolves.toEqual(
      {
        revokedBetterAuthSessions: 4,
        revokedLegacySessions: 3,
      },
    );

    expect(execute).toHaveBeenNthCalledWith(1, {
      sql: expect.stringContaining("required_auth_provider"),
      args: ["google", "builder"],
    });
    expect(execute).toHaveBeenNthCalledWith(2, {
      sql: expect.stringContaining('DELETE FROM "session"'),
      args: ["builder"],
    });
    expect(execute).toHaveBeenNthCalledWith(3, {
      sql: expect.stringContaining("DELETE FROM sessions"),
      args: ["builder"],
    });
  });

  it("does not revoke sessions when the requirement is cleared", async () => {
    execute.mockResolvedValueOnce({ rowsAffected: 1 });

    await expect(setRequiredAuthProvider("builder", null)).resolves.toEqual({
      revokedBetterAuthSessions: 0,
      revokedLegacySessions: 0,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
