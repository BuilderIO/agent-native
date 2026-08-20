import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the store module
const mockGetSetting = vi.fn();
const mockMutateSetting = vi.fn();
const mockPutSetting = vi.fn();
const mockDeleteSetting = vi.fn();
const mockDeleteSettingIfValue = vi.fn();

vi.mock("./store.js", () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
  mutateSetting: (...args: any[]) => mockMutateSetting(...args),
  putSetting: (...args: any[]) => mockPutSetting(...args),
  deleteSetting: (...args: any[]) => mockDeleteSetting(...args),
  deleteSettingIfValue: (...args: any[]) => mockDeleteSettingIfValue(...args),
}));

import {
  getUserSetting,
  mutateUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "./user-settings.js";

describe("user-settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getUserSetting", () => {
    it("prefixes key with u:<email>:", async () => {
      mockGetSetting.mockResolvedValue({ theme: "dark" });

      const result = await getUserSetting("alice@test.com", "theme");

      expect(mockGetSetting).toHaveBeenCalledWith("u:alice@test.com:theme");
      expect(result).toEqual({ theme: "dark" });
    });

    it("returns null when setting does not exist", async () => {
      mockGetSetting.mockResolvedValue(null);

      const result = await getUserSetting("alice@test.com", "missing");
      expect(result).toBeNull();
    });

    it("handles email with special characters", async () => {
      mockGetSetting.mockResolvedValue({ val: 1 });

      await getUserSetting("user+tag@example.com", "key");
      expect(mockGetSetting).toHaveBeenCalledWith("u:user+tag@example.com:key");
    });
  });

  describe("putUserSetting", () => {
    it("prefixes key with u:<email>:", async () => {
      mockPutSetting.mockResolvedValue(undefined);

      await putUserSetting("alice@test.com", "theme", { theme: "dark" });

      expect(mockPutSetting).toHaveBeenCalledWith(
        "u:alice@test.com:theme",
        { theme: "dark" },
        undefined,
      );
    });

    it("passes options through", async () => {
      mockPutSetting.mockResolvedValue(undefined);

      await putUserSetting(
        "alice@test.com",
        "pref",
        { v: 1 },
        {
          requestSource: "tab-1",
        },
      );

      expect(mockPutSetting).toHaveBeenCalledWith(
        "u:alice@test.com:pref",
        { v: 1 },
        { requestSource: "tab-1" },
      );
    });
  });

  describe("mutateUserSetting", () => {
    it("mutates a legacy mixed-case key when normalized storage is absent", async () => {
      const legacyValue = { servers: [{ id: "mcps_legacy" }] };
      mockGetSetting
        .mockResolvedValueOnce(legacyValue)
        .mockResolvedValueOnce(legacyValue);
      mockDeleteSettingIfValue.mockResolvedValue(true);
      const updater = vi.fn(() => legacyValue);
      mockMutateSetting.mockImplementation(
        async (_key: string, callback: (value: unknown) => unknown) =>
          callback(null),
      );

      await mutateUserSetting("Alice@Test.com", "mcp-servers-remote", updater);

      expect(mockMutateSetting).toHaveBeenCalledWith(
        "u:alice@test.com:mcp-servers-remote",
        expect.any(Function),
        undefined,
      );
      expect(updater).toHaveBeenCalledWith({
        servers: [{ id: "mcps_legacy" }],
      });
      expect(mockDeleteSettingIfValue).toHaveBeenCalledWith(
        "u:Alice@Test.com:mcp-servers-remote",
        legacyValue,
        undefined,
      );
    });

    it("leaves a newer legacy value when migration loses the cleanup race", async () => {
      const legacyValue = { servers: [{ id: "mcps_legacy" }] };
      const newerLegacyValue = { servers: [{ id: "mcps_newer" }] };
      mockGetSetting
        .mockResolvedValueOnce(legacyValue)
        .mockResolvedValueOnce(newerLegacyValue);
      mockDeleteSettingIfValue.mockResolvedValue(false);
      const updater = vi.fn(() => legacyValue);
      mockMutateSetting.mockImplementation(
        async (_key: string, callback: (value: unknown) => unknown) =>
          callback(null),
      );

      await expect(
        mutateUserSetting("Alice@Test.com", "mcp-servers-remote", updater),
      ).resolves.toEqual(legacyValue);

      expect(mockDeleteSettingIfValue).toHaveBeenCalledWith(
        "u:Alice@Test.com:mcp-servers-remote",
        legacyValue,
        undefined,
      );
      expect(updater).toHaveBeenCalledWith(legacyValue);
    });

    it("does not resurrect a legacy setting when deletion wins during migration", async () => {
      const legacyValue = { servers: [{ id: "mcps_deleted" }] };
      let legacyReads = 0;
      mockGetSetting.mockImplementation(async () =>
        legacyReads++ === 0 ? legacyValue : null,
      );
      mockDeleteSettingIfValue.mockImplementation(
        async (key: string) => key === "u:alice@test.com:mcp-servers-remote",
      );
      mockMutateSetting.mockImplementation(
        async (_key: string, callback: (value: unknown) => unknown) =>
          callback(null),
      );

      await expect(
        mutateUserSetting("Alice@Test.com", "mcp-servers-remote", () => ({
          servers: legacyValue.servers,
        })),
      ).rejects.toThrow("deleted while migrating");
      expect(mockDeleteSettingIfValue).toHaveBeenNthCalledWith(
        1,
        "u:Alice@Test.com:mcp-servers-remote",
        legacyValue,
        undefined,
      );
      expect(mockDeleteSettingIfValue).toHaveBeenNthCalledWith(
        2,
        "u:alice@test.com:mcp-servers-remote",
        { servers: legacyValue.servers },
        undefined,
      );
    });
  });

  describe("deleteUserSetting", () => {
    it("prefixes key with u:<email>:", async () => {
      mockDeleteSetting.mockResolvedValue(true);

      const result = await deleteUserSetting("alice@test.com", "old");

      expect(mockDeleteSetting).toHaveBeenCalledWith(
        "u:alice@test.com:old",
        undefined,
      );
      expect(result).toBe(true);
    });

    it("deletes both canonical and legacy keys", async () => {
      mockDeleteSetting.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

      const result = await deleteUserSetting("Alice@Test.com", "old");

      expect(mockDeleteSetting).toHaveBeenNthCalledWith(
        1,
        "u:alice@test.com:old",
        undefined,
      );
      expect(mockDeleteSetting).toHaveBeenNthCalledWith(
        2,
        "u:Alice@Test.com:old",
        undefined,
      );
      expect(result).toBe(true);
    });

    it("returns false when nothing was deleted", async () => {
      mockDeleteSetting.mockResolvedValue(false);

      const result = await deleteUserSetting("alice@test.com", "nonexist");
      expect(result).toBe(false);
    });

    it("passes options through", async () => {
      mockDeleteSetting.mockResolvedValue(true);

      await deleteUserSetting("alice@test.com", "key", {
        requestSource: "src",
      });

      expect(mockDeleteSetting).toHaveBeenCalledWith("u:alice@test.com:key", {
        requestSource: "src",
      });
    });
  });

  describe("key isolation", () => {
    it("different users have different prefixed keys", async () => {
      mockGetSetting.mockResolvedValue({ v: 1 });

      await getUserSetting("alice@test.com", "theme");
      await getUserSetting("bob@test.com", "theme");

      expect(mockGetSetting).toHaveBeenCalledWith("u:alice@test.com:theme");
      expect(mockGetSetting).toHaveBeenCalledWith("u:bob@test.com:theme");
    });
  });
});
