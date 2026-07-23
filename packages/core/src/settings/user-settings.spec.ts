import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the store module
const mockGetSetting = vi.fn();
const mockPutSetting = vi.fn();
const mockDeleteSetting = vi.fn();
const mockMutateSetting = vi.fn();

vi.mock("./store.js", () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
  putSetting: (...args: any[]) => mockPutSetting(...args),
  deleteSetting: (...args: any[]) => mockDeleteSetting(...args),
  mutateSetting: (...args: any[]) => mockMutateSetting(...args),
}));

import {
  getUserSetting,
  mutateUserSetting,
  putUserSetting,
  deleteUserSetting,
} from "./user-settings.js";

describe("user-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    it("atomically mutates only the prefixed user key", async () => {
      const updater = vi.fn((current) => ({
        count: Number(current?.count ?? 0) + 1,
      }));
      mockMutateSetting.mockResolvedValue({ count: 2 });

      const result = await mutateUserSetting(
        "alice@test.com",
        "counter",
        updater,
        { requestSource: "tab-1" },
      );

      expect(mockMutateSetting).toHaveBeenCalledWith(
        "u:alice@test.com:counter",
        updater,
        { requestSource: "tab-1" },
      );
      expect(result).toEqual({ count: 2 });
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
