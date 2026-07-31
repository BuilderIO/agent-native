import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock dependencies ---

const mockAppStateGet = vi.fn();
const mockAppStateGetManyEntries = vi.fn();
const mockAppStatePut = vi.fn();
const mockAppStateDelete = vi.fn();
const mockAppStateList = vi.fn();
const mockAppStateDeleteByPrefix = vi.fn();

vi.mock("./store.js", () => ({
  appStateGet: (...args: any[]) => mockAppStateGet(...args),
  appStateGetManyEntries: (...args: any[]) =>
    mockAppStateGetManyEntries(...args),
  appStatePut: (...args: any[]) => mockAppStatePut(...args),
  appStateDelete: (...args: any[]) => mockAppStateDelete(...args),
  appStateList: (...args: any[]) => mockAppStateList(...args),
  appStateDeleteByPrefix: (...args: any[]) =>
    mockAppStateDeleteByPrefix(...args),
}));

vi.mock("../server/auth.js", () => ({
  getSession: vi.fn().mockResolvedValue({ email: "user@example.com" }),
}));

let lastStatus = 200;

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  createError: (opts: any) =>
    Object.assign(new Error(opts.statusMessage), opts),
  readBody: (event: any) => Promise.resolve(event._body),
  getRouterParam: (event: any, key: string) => event._params?.[key],
  getQuery: (event: any) => event._query ?? {},
  getHeader: (event: any, name: string) => event._headers?.[name.toLowerCase()],
  setResponseStatus: (_event: any, code: number) => {
    lastStatus = code;
  },
}));

import { getSession } from "../server/auth.js";
import {
  getState,
  getStateMany,
  MAX_APP_STATE_BATCH_KEYS,
  putState,
  deleteState,
  listComposeDrafts,
  getComposeDraft,
  putComposeDraft,
  deleteComposeDraft,
  deleteAllComposeDrafts,
} from "./handlers.js";

describe("application-state handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastStatus = 200;
    vi.mocked(getSession).mockResolvedValue({
      email: "user@example.com",
    } as any);
  });

  describe("safeKey", () => {
    it("strips special characters from keys", async () => {
      mockAppStateGet.mockResolvedValue(null);

      const event = { _params: { key: "test!@#$%^&*()" }, _headers: {} };
      await getState(event);

      expect(mockAppStateGet).toHaveBeenCalledWith("user@example.com", "test");
    });

    it("preserves alphanumeric, hyphens, underscores, and colons", async () => {
      mockAppStateGet.mockResolvedValue(null);

      const event = { _params: { key: "my-key_123:tab-1" }, _headers: {} };
      await getState(event);

      expect(mockAppStateGet).toHaveBeenCalledWith(
        "user@example.com",
        "my-key_123:tab-1",
      );
    });
  });

  describe("getState", () => {
    it("returns state value when found", async () => {
      const value = { count: 42 };
      mockAppStateGet.mockResolvedValue(value);

      const event = { _params: { key: "counter" }, _headers: {} };
      const result = await getState(event);

      expect(result).toEqual(value);
    });

    it("returns null when state not found", async () => {
      mockAppStateGet.mockResolvedValue(null);

      const event = { _params: { key: "missing" }, _headers: {} };
      const result = await getState(event);

      expect(result).toBeNull();
    });

    it("rejects unauthenticated requests instead of sharing local state", async () => {
      vi.mocked(getSession).mockResolvedValue(null as any);
      mockAppStateGet.mockResolvedValue({ leaked: true });

      const event = { _params: { key: "navigation" }, _headers: {} };
      await expect(getState(event)).rejects.toMatchObject({
        statusCode: 401,
      });

      expect(mockAppStateGet).not.toHaveBeenCalled();
    });
  });

  describe("getStateMany", () => {
    it("returns every requested key in a single store read", async () => {
      mockAppStateGetManyEntries.mockResolvedValue([
        { key: "navigation", value: { view: "detail" } },
        { key: "selection:tab-1", value: { ids: ["a"] } },
      ]);

      const event = { _query: { keys: "navigation,selection:tab-1" } };
      const result = await getStateMany(event);

      expect(mockAppStateGetManyEntries).toHaveBeenCalledTimes(1);
      expect(mockAppStateGetManyEntries).toHaveBeenCalledWith(
        "user@example.com",
        ["navigation", "selection:tab-1"],
      );
      expect(result).toEqual({
        values: {
          navigation: { view: "detail" },
          "selection:tab-1": { ids: ["a"] },
        },
        missing: [],
      });
    });

    it("reports absent keys as missing, not as empty values", async () => {
      mockAppStateGetManyEntries.mockResolvedValue([
        { key: "stored-null", value: null },
        { key: "stored-empty", value: {} },
      ]);

      const event = {
        _query: { keys: "stored-null,stored-empty,never-written" },
      };
      const result = await getStateMany(event);

      expect(result).toEqual({
        values: { "stored-null": null, "stored-empty": {} },
        missing: ["never-written"],
      });
      // An absent key is absent from `values` entirely — a caller can tell it
      // apart from a key whose stored value happens to be null or empty.
      expect("never-written" in (result as any).values).toBe(false);
      expect((result as any).values["stored-null"]).toBeNull();
      expect((result as any).missing).not.toContain("stored-null");
    });

    it("scopes the read to the caller and rejects unauthenticated requests", async () => {
      vi.mocked(getSession).mockResolvedValue({
        email: "other@example.com",
      } as any);
      mockAppStateGetManyEntries.mockResolvedValue([]);
      await getStateMany({ _query: { keys: "navigation" } });
      expect(mockAppStateGetManyEntries).toHaveBeenCalledWith(
        "other@example.com",
        ["navigation"],
      );

      vi.mocked(getSession).mockResolvedValue(null as any);
      mockAppStateGetManyEntries.mockClear();
      await expect(
        getStateMany({ _query: { keys: "navigation" } }),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(mockAppStateGetManyEntries).not.toHaveBeenCalled();
    });

    it("sanitizes and de-duplicates keys the same way the single-key route does", async () => {
      mockAppStateGetManyEntries.mockResolvedValue([]);

      await getStateMany({
        _query: { keys: "test!@#$,navigation,navigation" },
      });

      expect(mockAppStateGetManyEntries).toHaveBeenCalledWith(
        "user@example.com",
        ["test", "navigation"],
      );
    });

    it("rejects an empty or oversized key list", async () => {
      await expect(getStateMany({ _query: {} })).rejects.toMatchObject({
        statusCode: 400,
      });
      const tooMany = Array.from(
        { length: MAX_APP_STATE_BATCH_KEYS + 1 },
        (_, i) => `k${i}`,
      ).join(",");
      await expect(
        getStateMany({ _query: { keys: tooMany } }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(mockAppStateGetManyEntries).not.toHaveBeenCalled();
    });

    it("leaves the single-key route untouched", async () => {
      mockAppStateGet.mockResolvedValue({ view: "detail" });

      const result = await getState({
        _params: { key: "navigation" },
        _headers: {},
      });

      expect(result).toEqual({ view: "detail" });
      expect(mockAppStateGetManyEntries).not.toHaveBeenCalled();
    });
  });

  describe("putState", () => {
    it("saves and returns the body", async () => {
      mockAppStatePut.mockResolvedValue(undefined);
      const body = { name: "Alice" };

      const event = {
        _params: { key: "user" },
        _body: body,
        _headers: {},
      };
      const result = await putState(event);

      expect(mockAppStatePut).toHaveBeenCalledWith(
        "user@example.com",
        "user",
        body,
        {
          requestSource: undefined,
        },
      );
      expect(result).toEqual(body);
    });

    it("passes x-request-source header", async () => {
      mockAppStatePut.mockResolvedValue(undefined);

      const event = {
        _params: { key: "test" },
        _body: { v: 1 },
        _headers: { "x-request-source": "tab-1" },
      };
      await putState(event);

      expect(mockAppStatePut).toHaveBeenCalledWith(
        "user@example.com",
        "test",
        { v: 1 },
        { requestSource: "tab-1" },
      );
    });
  });

  describe("deleteState", () => {
    it("deletes state and returns ok", async () => {
      mockAppStateDelete.mockResolvedValue(true);

      const event = {
        _params: { key: "old" },
        _headers: {},
      };
      const result = await deleteState(event);

      expect(mockAppStateDelete).toHaveBeenCalledWith(
        "user@example.com",
        "old",
        {
          requestSource: undefined,
        },
      );
      expect(result).toEqual({ ok: true });
    });

    it("passes x-request-source header", async () => {
      mockAppStateDelete.mockResolvedValue(true);

      const event = {
        _params: { key: "old" },
        _headers: { "x-request-source": "tab-1" },
      };
      await deleteState(event);

      expect(mockAppStateDelete).toHaveBeenCalledWith(
        "user@example.com",
        "old",
        {
          requestSource: "tab-1",
        },
      );
    });
  });

  describe("compose draft handlers", () => {
    describe("listComposeDrafts", () => {
      it("lists all compose drafts", async () => {
        mockAppStateList.mockResolvedValue([
          { key: "compose-1", value: { id: "1", subject: "Hello" } },
          { key: "compose-2", value: { id: "2", subject: "World" } },
        ]);

        const event = {};
        const result = await listComposeDrafts(event);

        expect(mockAppStateList).toHaveBeenCalledWith(
          "user@example.com",
          "compose-",
        );
        expect(result).toEqual([
          { id: "1", subject: "Hello" },
          { id: "2", subject: "World" },
        ]);
      });
    });

    describe("getComposeDraft", () => {
      it("returns a single draft by id", async () => {
        const draft = { id: "draft-1", subject: "Test", body: "Content" };
        mockAppStateGet.mockResolvedValue(draft);

        const event = { _params: { id: "draft-1" } };
        const result = await getComposeDraft(event);

        expect(mockAppStateGet).toHaveBeenCalledWith(
          "user@example.com",
          "compose-draft-1",
        );
        expect(result).toEqual(draft);
      });

      it("returns null when draft not found", async () => {
        mockAppStateGet.mockResolvedValue(null);

        const event = { _params: { id: "missing" } };
        const result = await getComposeDraft(event);

        expect(result).toBeNull();
      });
    });

    describe("putComposeDraft", () => {
      it("creates/updates a compose draft", async () => {
        mockAppStatePut.mockResolvedValue(undefined);

        const event = {
          _params: { id: "d1" },
          _body: { subject: "Hi", body: "Hello there" },
          _headers: {},
        };
        const result = await putComposeDraft(event);

        expect(mockAppStatePut).toHaveBeenCalledWith(
          "user@example.com",
          "compose-d1",
          { subject: "Hi", body: "Hello there", id: "d1" },
          { requestSource: undefined },
        );
        expect(result).toEqual({
          subject: "Hi",
          body: "Hello there",
          id: "d1",
        });
      });

      it("returns 400 when subject is missing", async () => {
        const event = {
          _params: { id: "d1" },
          _body: { body: "content" },
          _headers: {},
        };
        const result = await putComposeDraft(event);

        expect(lastStatus).toBe(400);
        expect(result).toEqual({
          error: "subject and body are required strings",
        });
      });

      it("returns 400 when body is missing", async () => {
        const event = {
          _params: { id: "d1" },
          _body: { subject: "test" },
          _headers: {},
        };
        const result = await putComposeDraft(event);

        expect(lastStatus).toBe(400);
      });

      it("returns 400 when subject is not a string", async () => {
        const event = {
          _params: { id: "d1" },
          _body: { subject: 123, body: "text" },
          _headers: {},
        };
        const result = await putComposeDraft(event);

        expect(lastStatus).toBe(400);
      });
    });

    describe("deleteComposeDraft", () => {
      it("deletes a single draft", async () => {
        mockAppStateDelete.mockResolvedValue(true);

        const event = {
          _params: { id: "d1" },
          _headers: {},
        };
        const result = await deleteComposeDraft(event);

        expect(mockAppStateDelete).toHaveBeenCalledWith(
          "user@example.com",
          "compose-d1",
          {
            requestSource: undefined,
          },
        );
        expect(result).toEqual({ ok: true });
      });
    });

    describe("deleteAllComposeDrafts", () => {
      it("deletes all compose drafts by prefix", async () => {
        mockAppStateDeleteByPrefix.mockResolvedValue(3);

        const event = { _headers: {} };
        const result = await deleteAllComposeDrafts(event);

        expect(mockAppStateDeleteByPrefix).toHaveBeenCalledWith(
          "user@example.com",
          "compose-",
          { requestSource: undefined },
        );
        expect(result).toEqual({ ok: true });
      });
    });
  });
});
