import { beforeEach, describe, expect, it, vi } from "vitest";

const getBetterAuthSyncMock = vi.fn();
const getBetterAuthInternalAdapterMock = vi.fn();
const getUserSettingMock = vi.fn();

vi.mock("../server/better-auth-instance.js", () => ({
  getBetterAuthSync: () => getBetterAuthSyncMock(),
  getBetterAuthInternalAdapter: () => getBetterAuthInternalAdapterMock(),
}));
vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: (...args: unknown[]) => getUserSettingMock(...args),
  putUserSetting: vi.fn(),
}));

const { getUserProfile, getUserProfiles } = await import("./store.js");

describe("user profile store", () => {
  const adapter = {
    findUserByEmail: vi.fn(),
    listUsers: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getBetterAuthSyncMock.mockReturnValue(true);
    getBetterAuthInternalAdapterMock.mockResolvedValue(adapter);
    getUserSettingMock.mockResolvedValue({ name: "Saved Name" });

    const user = {
      email: "alice@example.com",
      name: "alice",
      image: "https://lh3.googleusercontent.com/a/avatar.jpg",
    };
    adapter.findUserByEmail.mockResolvedValue({ user });
    adapter.listUsers.mockResolvedValue([user]);
  });

  it("preserves an explicit saved name while using the Google profile image", async () => {
    await expect(getUserProfile("alice@example.com")).resolves.toEqual({
      email: "alice@example.com",
      name: "Saved Name",
      image: "https://lh3.googleusercontent.com/a/avatar.jpg",
    });

    await expect(getUserProfiles(["alice@example.com"])).resolves.toEqual(
      new Map([
        [
          "alice@example.com",
          {
            email: "alice@example.com",
            name: "Saved Name",
            image: "https://lh3.googleusercontent.com/a/avatar.jpg",
          },
        ],
      ]),
    );
  });
});
