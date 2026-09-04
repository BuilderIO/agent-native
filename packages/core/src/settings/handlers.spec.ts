import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the store module
const mockGetSetting = vi.fn();
const mockPutSetting = vi.fn();
const mockDeleteSetting = vi.fn();

vi.mock("./store.js", () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
  putSetting: (...args: any[]) => mockPutSetting(...args),
  deleteSetting: (...args: any[]) => mockDeleteSetting(...args),
}));

// Track setResponseStatus calls per event
let lastStatus = 200;

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  readBody: (event: any) => Promise.resolve(event._body),
  getRouterParam: (event: any, key: string) => event._params?.[key],
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
  setResponseStatus: (_event: any, code: number) => {
    lastStatus = code;
  },
}));

import {
  getSettingHandler,
  putSettingHandler,
  deleteSettingHandler,
} from "./handlers.js";

describe("settings handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastStatus = 200;
  });

  describe("safeKey sanitization", () => {
    it("strips unsafe characters from keys", async () => {
      mockGetSetting.mockResolvedValue({ data: "test" });

      const event = { _params: { key: "my-key!@#$%^" }, _headers: {} };
      await getSettingHandler(event);

      expect(mockGetSetting).toHaveBeenCalledWith("my-key");
    });

    it("preserves alphanumeric, underscores, and hyphens", async () => {
      mockGetSetting.mockResolvedValue({ data: "test" });

      const event = { _params: { key: "my_key-123" }, _headers: {} };
      await getSettingHandler(event);

      expect(mockGetSetting).toHaveBeenCalledWith("my_key-123");
    });

    it("handles key that is entirely special characters", async () => {
      mockGetSetting.mockResolvedValue(null);

      const event = { _params: { key: "!@#$" }, _headers: {} };
      await getSettingHandler(event);

      // All chars stripped, resulting key is empty string
      expect(mockGetSetting).toHaveBeenCalledWith("");
    });
  });

  describe("getSettingHandler", () => {
    it("returns setting value when found", async () => {
      const value = { theme: "dark" };
      mockGetSetting.mockResolvedValue(value);

      const event = { _params: { key: "theme" }, _headers: {} };
      const result = await getSettingHandler(event);

      expect(result).toEqual(value);
      expect(lastStatus).toBe(200);
    });

    it("returns 404 when setting not found", async () => {
      mockGetSetting.mockResolvedValue(null);

      const event = { _params: { key: "missing" }, _headers: {} };
      const result = await getSettingHandler(event);

      expect(lastStatus).toBe(404);
      expect(result).toEqual({ error: "No setting for missing" });
    });
  });

  describe("putSettingHandler", () => {
    it("saves and returns the body", async () => {
      mockPutSetting.mockResolvedValue(undefined);

      const body = { color: "blue" };
      const event = {
        _params: { key: "pref" },
        _body: body,
        _headers: {},
      };
      const result = await putSettingHandler(event);

      expect(mockPutSetting).toHaveBeenCalledWith("pref", body, {
        requestSource: undefined,
      });
      expect(result).toEqual(body);
    });

    it("passes x-request-source header to store", async () => {
      mockPutSetting.mockResolvedValue(undefined);

      const body = { val: 1 };
      const event = {
        _params: { key: "test" },
        _body: body,
        _headers: { "x-request-source": "tab-42" },
      };
      await putSettingHandler(event);

      expect(mockPutSetting).toHaveBeenCalledWith("test", body, {
        requestSource: "tab-42",
      });
    });
  });

  describe("deleteSettingHandler", () => {
    it("deletes and returns ok", async () => {
      mockDeleteSetting.mockResolvedValue(true);

      const event = {
        _params: { key: "old-key" },
        _headers: {},
      };
      const result = await deleteSettingHandler(event);

      expect(mockDeleteSetting).toHaveBeenCalledWith("old-key", {
        requestSource: undefined,
      });
      expect(result).toEqual({ ok: true });
    });

    it("passes x-request-source header on delete", async () => {
      mockDeleteSetting.mockResolvedValue(true);

      const event = {
        _params: { key: "key" },
        _headers: { "x-request-source": "tab-1" },
      };
      await deleteSettingHandler(event);

      expect(mockDeleteSetting).toHaveBeenCalledWith("key", {
        requestSource: "tab-1",
      });
    });
  });
});
