import { beforeEach, describe, expect, it, vi } from "vitest";

const getBetterAuthSyncMock = vi.fn();
const getBetterAuthInternalAdapterMock = vi.fn();
const getUserSettingMock = vi.fn();
const getUserSettingsMock = vi.fn();

vi.mock("../server/better-auth-instance.js", () => ({
  getBetterAuthSync: () => getBetterAuthSyncMock(),
  getBetterAuthInternalAdapter: () => getBetterAuthInternalAdapterMock(),
}));
vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: (...args: unknown[]) => getUserSettingMock(...args),
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
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
    getUserSettingsMock.mockImplementation(
      async (emails: readonly string[]) =>
        new Map(emails.map((email) => [email, { name: "Saved Name" }])),
    );

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
      onboardingRole: null,
    });

    await expect(getUserProfiles(["alice@example.com"])).resolves.toEqual(
      new Map([
        [
          "alice@example.com",
          {
            email: "alice@example.com",
            name: "Saved Name",
            image: "https://lh3.googleusercontent.com/a/avatar.jpg",
            onboardingRole: null,
          },
        ],
      ]),
    );
  });

  it("issues one listUsers call and one settings batch for N emails, not N settings reads", async () => {
    const emails = Array.from(
      { length: 50 },
      (_, i) => `user-${i}@example.com`,
    );
    const users = emails.map((email) => ({ email, name: null, image: null }));
    adapter.listUsers.mockResolvedValue(users);
    getUserSettingsMock.mockResolvedValue(new Map());

    const profiles = await getUserProfiles(emails);

    expect(profiles.size).toBe(50);
    expect(adapter.listUsers).toHaveBeenCalledTimes(1);
    expect(getUserSettingsMock).toHaveBeenCalledTimes(1);
    expect(getUserSettingsMock).toHaveBeenCalledWith(emails, "user-profile");
    expect(getUserSettingMock).not.toHaveBeenCalled();
  });

  it("falls back to the stored or derived name for emails with no auth user", async () => {
    adapter.listUsers.mockResolvedValue([]);
    getUserSettingsMock.mockResolvedValue(
      new Map([
        ["stored@example.com", { name: "Stored Only" }],
        ["derived@example.com", null],
      ]),
    );

    const profiles = await getUserProfiles([
      "stored@example.com",
      "derived@example.com",
    ]);

    expect(profiles.get("stored@example.com")).toEqual({
      email: "stored@example.com",
      name: "Stored Only",
      onboardingRole: null,
    });
    expect(profiles.get("derived@example.com")).toEqual({
      email: "derived@example.com",
      name: "derived@example.com",
      onboardingRole: null,
    });
    expect(getUserSettingMock).not.toHaveBeenCalled();
  });

  it("retries stored names individually for matched users when the settings batch fails", async () => {
    getUserSettingsMock.mockRejectedValue(new Error("settings down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const profiles = await getUserProfiles(["alice@example.com"]);

    expect(profiles.get("alice@example.com")).toEqual({
      email: "alice@example.com",
      name: "Saved Name",
      image: "https://lh3.googleusercontent.com/a/avatar.jpg",
      onboardingRole: null,
    });
    expect(getUserSettingMock).toHaveBeenCalledWith(
      "alice@example.com",
      "user-profile",
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still resolves emails with no auth user through the per-email fallback when the settings batch fails", async () => {
    getUserSettingsMock.mockRejectedValue(new Error("settings down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const profiles = await getUserProfiles([
      "alice@example.com",
      "missing@example.com",
    ]);

    expect(profiles.get("alice@example.com")).toEqual({
      email: "alice@example.com",
      name: "Saved Name",
      image: "https://lh3.googleusercontent.com/a/avatar.jpg",
      onboardingRole: null,
    });
    expect(profiles.get("missing@example.com")).toEqual({
      email: "missing@example.com",
      name: "Saved Name",
      onboardingRole: null,
    });
    warn.mockRestore();
  });

  it("falls back to per-email lookups and warns once when listUsers fails", async () => {
    adapter.listUsers.mockRejectedValue(new Error("adapter down"));
    adapter.findUserByEmail.mockResolvedValue(null);
    getUserSettingMock.mockResolvedValue({ name: "Fallback Name" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const profiles = await getUserProfiles(["alice@example.com"]);

    expect(profiles.get("alice@example.com")).toEqual({
      email: "alice@example.com",
      name: "Fallback Name",
      onboardingRole: null,
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
