import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the store module
const mockAppStateGet = vi.fn();
const mockAppStatePut = vi.fn();
const mockAppStateDelete = vi.fn();
const mockAppStateList = vi.fn();
const mockAppStateDeleteByPrefix = vi.fn();

vi.mock("./store.js", () => ({
  appStateGet: (...args: any[]) => mockAppStateGet(...args),
  appStatePut: (...args: any[]) => mockAppStatePut(...args),
  appStateDelete: (...args: any[]) => mockAppStateDelete(...args),
  appStateList: (...args: any[]) => mockAppStateList(...args),
  appStateDeleteByPrefix: (...args: any[]) =>
    mockAppStateDeleteByPrefix(...args),
}));

const mockDbExecute = vi.fn();
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockDbExecute }),
  isLocalDatabase: () => true,
}));

describe("application-state script-helpers", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
    // Reset modules to clear the cached _resolvedSessionId
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("session ID resolution", () => {
    it("uses email as session ID when AGENT_USER_EMAIL is set", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";

      const { readAppState } = await import("./script-helpers.js");
      mockAppStateGet.mockResolvedValue(null);

      await readAppState("key");
      expect(mockAppStateGet).toHaveBeenCalledWith("alice@test.com", "key");
    });

    it("throws when no AGENT_USER_EMAIL and no request context", async () => {
      delete process.env.AGENT_USER_EMAIL;

      const { readAppState } = await import("./script-helpers.js");
      mockAppStateGet.mockResolvedValue(null);

      await expect(readAppState("key")).rejects.toThrow(
        "Application state access requires an authenticated request context or AGENT_USER_EMAIL env var",
      );
      expect(mockAppStateGet).not.toHaveBeenCalled();
    });

    it("prefers request-context email over AGENT_USER_EMAIL env var", async () => {
      process.env.AGENT_USER_EMAIL = "stale@test.com";

      const { readAppState } = await import("./script-helpers.js");
      const { runWithRequestContext } =
        await import("../server/request-context.js");
      mockAppStateGet.mockResolvedValue(null);

      await runWithRequestContext({ userEmail: "fresh@test.com" }, () =>
        readAppState("key"),
      );
      expect(mockAppStateGet).toHaveBeenCalledWith("fresh@test.com", "key");
    });
  });

  describe("readAppState", () => {
    it("delegates to appStateGet with resolved session ID", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { readAppState } = await import("./script-helpers.js");
      const value = { data: "test" };
      mockAppStateGet.mockResolvedValue(value);

      const result = await readAppState("my-key");
      expect(result).toEqual(value);
      expect(mockAppStateGet).toHaveBeenCalledWith("alice@test.com", "my-key");
    });
  });

  describe("writeAppState", () => {
    it("delegates to appStatePut", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { writeAppState } = await import("./script-helpers.js");
      mockAppStatePut.mockResolvedValue(undefined);

      await writeAppState("key", { foo: "bar" });
      expect(mockAppStatePut).toHaveBeenCalledWith(
        "alice@test.com",
        "key",
        {
          foo: "bar",
        },
        { requestSource: "agent" },
      );
    });
  });

  describe("deleteAppState", () => {
    it("delegates to appStateDelete", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { deleteAppState } = await import("./script-helpers.js");
      mockAppStateDelete.mockResolvedValue(true);

      const result = await deleteAppState("key");
      expect(result).toBe(true);
      expect(mockAppStateDelete).toHaveBeenCalledWith("alice@test.com", "key", {
        requestSource: "agent",
      });
    });
  });

  describe("listAppState", () => {
    it("delegates to appStateList with prefix", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { listAppState } = await import("./script-helpers.js");
      const items = [{ key: "compose-1", value: { text: "hi" } }];
      mockAppStateList.mockResolvedValue(items);

      const result = await listAppState("compose-");
      expect(result).toEqual(items);
      expect(mockAppStateList).toHaveBeenCalledWith(
        "alice@test.com",
        "compose-",
      );
    });
  });

  describe("deleteAppStateByPrefix", () => {
    it("delegates to appStateDeleteByPrefix", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { deleteAppStateByPrefix } = await import("./script-helpers.js");
      mockAppStateDeleteByPrefix.mockResolvedValue(3);

      const result = await deleteAppStateByPrefix("compose-");
      expect(result).toBe(3);
      expect(mockAppStateDeleteByPrefix).toHaveBeenCalledWith(
        "alice@test.com",
        "compose-",
        { requestSource: "agent" },
      );
    });
  });
});
