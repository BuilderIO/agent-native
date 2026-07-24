import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserProfileMock = vi.fn();
const updateUserProfileMock = vi.fn();

vi.mock("../store.js", () => ({
  getUserProfile: (...args: unknown[]) => getUserProfileMock(...args),
  updateUserProfile: (...args: unknown[]) => updateUserProfileMock(...args),
}));

const getProfile = (await import("./get-user-profile.js")).default;
const updateProfile = (await import("./update-user-profile.js")).default;

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
});
