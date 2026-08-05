import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserProfileMock = vi.fn();
const updateUserProfileMock = vi.fn();
const getBetterAuthMock = vi.fn();
let auth: {
  api: {
    listUserAccounts: ReturnType<typeof vi.fn>;
    setPassword: ReturnType<typeof vi.fn>;
    changePassword: ReturnType<typeof vi.fn>;
  };
};

vi.mock("../store.js", () => ({
  getUserProfile: (...args: unknown[]) => getUserProfileMock(...args),
  updateUserProfile: (...args: unknown[]) => updateUserProfileMock(...args),
}));
vi.mock("../../server/better-auth-instance.js", () => ({
  getBetterAuth: (...args: unknown[]) => getBetterAuthMock(...args),
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

  it("reads password availability through Better Auth", async () => {
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

    expect(auth.api.listUserAccounts).toHaveBeenCalledWith({ headers });
    expect(getAuthMethods.agentTool).toBe(false);
    expect(getAuthMethods.toolCallable).toBe(false);
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
