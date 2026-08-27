import { beforeEach, describe, expect, it, vi } from "vitest";

import { PASSWORD_MIN_LENGTH } from "../../shared/password-policy.js";

const getUserProfileMock = vi.fn();
const updateUserProfileMock = vi.fn();
const getBetterAuthMock = vi.fn();
const getBetterAuthActionHeadersMock = vi.fn();
const getBetterAuthInternalAdapterMock = vi.fn();
let auth: {
  api: {
    listUserAccounts: ReturnType<typeof vi.fn>;
    setPassword: ReturnType<typeof vi.fn>;
    changePassword: ReturnType<typeof vi.fn>;
  };
};
let internalAdapter: {
  findUserByEmail: ReturnType<typeof vi.fn>;
};

vi.mock("../store.js", () => ({
  getUserProfile: (...args: unknown[]) => getUserProfileMock(...args),
  updateUserProfile: (...args: unknown[]) => updateUserProfileMock(...args),
}));
vi.mock("../../server/better-auth-instance.js", () => ({
  getBetterAuth: (...args: unknown[]) => getBetterAuthMock(...args),
  getBetterAuthActionHeaders: (...args: unknown[]) =>
    getBetterAuthActionHeadersMock(...args),
  getBetterAuthInternalAdapter: (...args: unknown[]) =>
    getBetterAuthInternalAdapterMock(...args),
}));

const getProfile = (await import("./get-user-profile.js")).default;
const updateProfile = (await import("./update-user-profile.js")).default;
const getAuthMethods = (await import("./get-auth-methods.js")).default;
const setPassword = (await import("./set-password.js")).default;
const changePassword = (await import("./change-password.js")).default;

describe("user profile actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserProfileMock.mockResolvedValue({
      email: "alice@example.com",
      name: "Alice",
    });
    updateUserProfileMock.mockResolvedValue({
      email: "alice@example.com",
      name: "Alice Smith",
    });
    auth = {
      api: {
        listUserAccounts: vi
          .fn()
          .mockResolvedValue([
            { providerId: "credential" },
            { providerId: "google" },
          ]),
        setPassword: vi.fn().mockResolvedValue({ status: true }),
        changePassword: vi.fn().mockResolvedValue({ status: true }),
      },
    };
    getBetterAuthMock.mockResolvedValue(auth);
    getBetterAuthActionHeadersMock.mockImplementation(
      (_email: string, headers: Headers) => headers,
    );
    internalAdapter = {
      findUserByEmail: vi.fn().mockResolvedValue({
        user: { id: "user-1", email: "alice@example.com" },
        accounts: [
          {
            id: "acc-1",
            providerId: "credential",
            accountId: "alice@example.com",
          },
          { id: "acc-2", providerId: "google", accountId: "alice@example.com" },
        ],
      }),
    };
    getBetterAuthInternalAdapterMock.mockResolvedValue(internalAdapter);
  });

  it("exposes a read action for the current profile", async () => {
    expect(getProfile.http).toEqual({ method: "GET" });
    await expect(
      getProfile.run(
        {},
        { caller: "frontend", userEmail: "alice@example.com" },
      ),
    ).resolves.toEqual({ email: "alice@example.com", name: "Alice" });
    expect(getUserProfileMock).toHaveBeenCalledWith("alice@example.com");
  });

  it("updates only the authenticated user's display name", async () => {
    await expect(
      updateProfile.run(
        { name: "Alice Smith" },
        { caller: "frontend", userEmail: "alice@example.com" },
      ),
    ).resolves.toEqual({ email: "alice@example.com", name: "Alice Smith" });
    expect(updateUserProfileMock).toHaveBeenCalledWith(
      "alice@example.com",
      "Alice Smith",
    );
  });

  it("requires authentication", async () => {
    await expect(getProfile.run({}, { caller: "frontend" })).rejects.toThrow(
      "Not authenticated",
    );
    await expect(
      updateProfile.run({ name: "Alice" }, { caller: "frontend" }),
    ).rejects.toThrow("Not authenticated");
  });

  it("reads password availability by the resolved user email", async () => {
    const headers = new Headers();
    await expect(
      getAuthMethods.run(
        {},
        {
          caller: "frontend",
          userEmail: "alice@example.com",
          requestHeaders: headers,
        },
      ),
    ).resolves.toEqual({ hasPassword: true });

    expect(internalAdapter.findUserByEmail).toHaveBeenCalledWith(
      "alice@example.com",
      { includeAccounts: true },
    );
    expect(getAuthMethods.agentTool).toBe(false);
    expect(getAuthMethods.toolCallable).toBe(false);
  });

  it("resolves password state for a caller with no Better Auth session cookie (e.g. AUTH_DISABLED dev sessions)", async () => {
    // AUTH_DISABLED mints ctx.userEmail without ever setting a real Better
    // Auth session cookie, so the cookie-based auth.api.listUserAccounts
    // path always 401s for it — reproduce that failure here to prove the
    // action no longer depends on that path for its data.
    auth.api.listUserAccounts.mockRejectedValue(
      Object.assign(new Error("UNAUTHORIZED"), { statusCode: 401 }),
    );
    internalAdapter.findUserByEmail.mockResolvedValue({
      user: { id: "dev-user", email: "dev@local.test" },
      accounts: [
        { id: "acc-1", providerId: "credential", accountId: "dev@local.test" },
      ],
    });

    await expect(
      getAuthMethods.run(
        {},
        {
          caller: "frontend",
          userEmail: "dev@local.test",
          requestHeaders: new Headers(),
        },
      ),
    ).resolves.toEqual({ hasPassword: true });
  });

  it("reports no password when the resolved email has no Better Auth user record", async () => {
    internalAdapter.findUserByEmail.mockResolvedValue(null);

    await expect(
      getAuthMethods.run(
        {},
        {
          caller: "frontend",
          userEmail: "dev@local.test",
          requestHeaders: new Headers(),
        },
      ),
    ).resolves.toEqual({ hasPassword: false });
  });

  it("throws instead of reporting no password when the internal adapter is unavailable", async () => {
    // getBetterAuthInternalAdapter returns undefined when $context resolution
    // fails or has an unexpected shape — an unreadable auth backend, not
    // confirmation that the user has no credential account. An existing
    // credential user must not see the "set password" state for this.
    getBetterAuthInternalAdapterMock.mockResolvedValue(undefined);

    await expect(
      getAuthMethods.run(
        {},
        {
          caller: "frontend",
          userEmail: "alice@example.com",
          requestHeaders: new Headers(),
        },
      ),
    ).rejects.toThrow();
    expect(internalAdapter.findUserByEmail).not.toHaveBeenCalled();
  });

  it("adds and changes passwords without exposing credential values", async () => {
    const headers = new Headers();
    await expect(
      setPassword.run(
        { newPassword: "new-password" },
        {
          caller: "frontend",
          userEmail: "alice@example.com",
          requestHeaders: headers,
        },
      ),
    ).resolves.toEqual({ status: true });
    await expect(
      changePassword.run(
        { currentPassword: "old-password", newPassword: "new-password" },
        {
          caller: "frontend",
          userEmail: "alice@example.com",
          requestHeaders: headers,
        },
      ),
    ).resolves.toEqual({ status: true });

    expect(auth.api.setPassword).toHaveBeenCalledWith({
      body: { newPassword: "new-password" },
      headers,
    });
    expect(auth.api.changePassword).toHaveBeenCalledWith({
      body: { currentPassword: "old-password", newPassword: "new-password" },
      headers,
    });
    expect(setPassword.agentTool).toBe(false);
    expect(setPassword.toolCallable).toBe(false);
    expect(changePassword.agentTool).toBe(false);
    expect(changePassword.toolCallable).toBe(false);
    expect(JSON.stringify(setPassword)).not.toContain("new-password");
  });

  it("passes a Better Auth session bridge to password actions", async () => {
    const frameworkHeaders = new Headers({
      cookie: "an_session=legacy-session",
    });
    const betterAuthHeaders = new Headers(frameworkHeaders);
    betterAuthHeaders.set("authorization", "Bearer better-auth-session");
    getBetterAuthActionHeadersMock.mockResolvedValue(betterAuthHeaders);

    await expect(
      changePassword.run(
        { currentPassword: "old-password", newPassword: "new-password" },
        {
          caller: "frontend",
          userEmail: "alice@example.com",
          requestHeaders: frameworkHeaders,
        },
      ),
    ).resolves.toEqual({ status: true });

    expect(getBetterAuthActionHeadersMock).toHaveBeenCalledWith(
      "alice@example.com",
      frameworkHeaders,
    );
    expect(auth.api.changePassword).toHaveBeenCalledWith({
      body: { currentPassword: "old-password", newPassword: "new-password" },
      headers: betterAuthHeaders,
    });
  });

  it("enforces the 12-character minimum before calling Better Auth", async () => {
    const context = {
      caller: "frontend" as const,
      userEmail: "alice@example.com",
      requestHeaders: new Headers(),
    };
    const shortPassword = "p".repeat(PASSWORD_MIN_LENGTH - 1);
    const validPassword = "p".repeat(PASSWORD_MIN_LENGTH);

    await expect(
      setPassword.run({ newPassword: shortPassword }, context),
    ).rejects.toThrow();
    expect(auth.api.setPassword).not.toHaveBeenCalled();

    await expect(
      setPassword.run({ newPassword: validPassword }, context),
    ).resolves.toEqual({ status: true });
    expect(auth.api.setPassword).toHaveBeenCalledWith({
      body: { newPassword: validPassword },
      headers: context.requestHeaders,
    });

    await expect(
      changePassword.run(
        { currentPassword: shortPassword, newPassword: validPassword },
        context,
      ),
    ).resolves.toEqual({ status: true });
    expect(auth.api.changePassword).toHaveBeenCalledWith({
      body: { currentPassword: shortPassword, newPassword: validPassword },
      headers: context.requestHeaders,
    });

    await expect(
      changePassword.run(
        { currentPassword: "", newPassword: validPassword },
        context,
      ),
    ).rejects.toThrow();
  });

  it("requires an authenticated request with headers for password actions", async () => {
    await expect(
      getAuthMethods.run(
        {},
        { caller: "frontend", userEmail: "alice@example.com" },
      ),
    ).rejects.toThrow("Not authenticated");
    await expect(
      setPassword.run(
        { newPassword: "new-password" },
        { caller: "frontend", userEmail: "alice@example.com" },
      ),
    ).rejects.toThrow("Not authenticated");
  });
});
