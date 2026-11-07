import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockAppStateGet = vi.fn();
const mockAppStatePut = vi.fn();
const mockAppStateDelete = vi.fn();
const mockAppStateCompareAndSet = vi.fn();
const mockAppStateCompareAndSetMany = vi.fn();
const mockAppStateList = vi.fn();
const mockAppStateDeleteByPrefix = vi.fn();

vi.mock("./store.js", () => ({
  appStateGet: (...args: any[]) => mockAppStateGet(...args),
  appStatePut: (...args: any[]) => mockAppStatePut(...args),
  appStateDelete: (...args: any[]) => mockAppStateDelete(...args),
  appStateCompareAndSet: (...args: any[]) => mockAppStateCompareAndSet(...args),
  appStateCompareAndSetMany: (...args: any[]) =>
    mockAppStateCompareAndSetMany(...args),
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

    it("uses a verified capability as the session ID for anonymous requests", async () => {
      delete process.env.AGENT_USER_EMAIL;

      const { readAppState } = await import("./script-helpers.js");
      const { runWithRequestContext } =
        await import("../server/request-context.js");
      mockAppStateGet.mockResolvedValue(null);

      await runWithRequestContext(
        { authCapability: "capability:visual-edit:design:design_1" },
        () => readAppState("key"),
      );

      expect(mockAppStateGet).toHaveBeenCalledWith(
        "capability:capability:visual-edit:design:design_1",
        "key",
      );
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

    it("scopes ambient navigation reads to the request browser tab", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { readAppState } = await import("./script-helpers.js");
      const { runWithRequestContext } =
        await import("../server/request-context.js");
      mockAppStateGet.mockResolvedValue({ view: "inbox" });

      await runWithRequestContext(
        { userEmail: "alice@test.com", run: { browserTabId: "tab-a" } },
        () => readAppState("navigation"),
      );

      expect(mockAppStateGet).toHaveBeenCalledWith(
        "alice@test.com",
        "navigation:tab-a",
      );
    });

    it("scopes pending selection context reads to the request browser tab", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { readAppState } = await import("./script-helpers.js");
      const { runWithRequestContext } =
        await import("../server/request-context.js");
      mockAppStateGet.mockResolvedValue({ text: "selected text" });

      await runWithRequestContext(
        { userEmail: "alice@test.com", run: { browserTabId: "tab-a" } },
        () => readAppState("pending-selection-context"),
      );

      expect(mockAppStateGet).toHaveBeenCalledWith(
        "alice@test.com",
        "pending-selection-context:tab-a",
      );
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

    it("scopes ambient navigation writes to the request browser tab", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { writeAppState } = await import("./script-helpers.js");
      const { runWithRequestContext } =
        await import("../server/request-context.js");
      mockAppStatePut.mockResolvedValue(undefined);

      await runWithRequestContext(
        { userEmail: "alice@test.com", run: { browserTabId: "tab-a" } },
        () => writeAppState("navigate", { view: "editor" }),
      );

      expect(mockAppStatePut).toHaveBeenCalledWith(
        "alice@test.com",
        "navigate:tab-a",
        { view: "editor" },
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

  describe("compareAndSetAppState", () => {
    it("delegates with the resolved session ID", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { compareAndSetAppState } = await import("./script-helpers.js");
      mockAppStateCompareAndSet.mockResolvedValue(true);

      await expect(
        compareAndSetAppState(
          "rewrite",
          { repromptId: "r1" },
          { repromptId: "r2" },
        ),
      ).resolves.toBe(true);
      expect(mockAppStateCompareAndSet).toHaveBeenCalledWith(
        "alice@test.com",
        "rewrite",
        { repromptId: "r1" },
        { repromptId: "r2" },
        { requestSource: "agent" },
      );
    });
  });

  describe("compareAndSetManyAppState", () => {
    it("delegates the complete transition with the resolved session ID", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { compareAndSetManyAppState } = await import("./script-helpers.js");
      mockAppStateCompareAndSetMany.mockResolvedValue(true);
      const operations = [
        {
          key: "pending",
          expectedValue: { repromptId: "r1" },
          nextValue: null,
        },
        {
          key: "proposal",
          expectedValue: { proposalId: "p1" },
          nextValue: null,
        },
      ];

      await expect(compareAndSetManyAppState(operations)).resolves.toBe(true);
      expect(mockAppStateCompareAndSetMany).toHaveBeenCalledWith(
        "alice@test.com",
        operations,
        { requestSource: "agent" },
      );
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

  describe("writeAppStateForCurrentTab", () => {
    it("keeps a one-shot command out of every other tab's key", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { writeAppStateForCurrentTab } =
        await import("./script-helpers.js");
      const { runWithRequestContext } =
        await import("../server/request-context.js");
      mockAppStatePut.mockResolvedValue(undefined);

      await runWithRequestContext(
        { userEmail: "alice@test.com", run: { browserTabId: "tab-a" } },
        () => writeAppStateForCurrentTab("navigate", { view: "editor" }),
      );

      expect(mockAppStatePut).toHaveBeenCalledWith(
        "alice@test.com",
        "navigate:tab-a",
        { view: "editor" },
        { requestSource: "agent" },
      );
    });

    it("writes the global key for callers with no browser tab", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { writeAppStateForCurrentTab } =
        await import("./script-helpers.js");
      mockAppStatePut.mockResolvedValue(undefined);

      await writeAppStateForCurrentTab("navigate", { view: "editor" });

      expect(mockAppStatePut).toHaveBeenCalledWith(
        "alice@test.com",
        "navigate",
        { view: "editor" },
        { requestSource: "agent" },
      );
    });
  });

  describe("readAppStateForCurrentTab", () => {
    it("surfaces scoped store failures instead of treating them as missing state", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { readAppStateForCurrentTab } = await import("./script-helpers.js");
      const { runWithRequestContext } =
        await import("../server/request-context.js");
      const failure = new Error("application state unavailable");
      mockAppStateGet.mockRejectedValue(failure);

      await expect(
        runWithRequestContext(
          { userEmail: "alice@test.com", run: { browserTabId: "tab-a" } },
          () => readAppStateForCurrentTab("navigation"),
        ),
      ).rejects.toThrow(failure);
      expect(mockAppStateGet).toHaveBeenCalledWith(
        "alice@test.com",
        "navigation:tab-a",
      );
    });
  });

  describe("a call from no tab, pointed at the tab used last", () => {
    async function inMcpCall<T>(
      target:
        | { kind: "last-used"; tabId: string; usedAt: number }
        | { kind: "unavailable" },
      fn: () => Promise<T>,
      run: { browserTabId?: string } = {},
    ): Promise<{ result: T; lookups: number }> {
      const { runWithRequestContext } =
        await import("../server/request-context.js");
      let lookups = 0;
      const result = await runWithRequestContext(
        {
          userEmail: "alice@test.com",
          run: {
            ...run,
            browserTabTarget: {
              resolve: async () => {
                lookups += 1;
                return target;
              },
            },
          },
        },
        fn,
      );
      return { result, lookups };
    }
    const lastUsedB = {
      kind: "last-used" as const,
      tabId: "tab-b",
      usedAt: 1,
    };

    it("reads and writes that tab's navigation and commands", async () => {
      const helpers = await import("./script-helpers.js");
      mockAppStateGet.mockResolvedValue({ view: "editor", designId: "b" });
      mockAppStatePut.mockResolvedValue(undefined);

      const { result } = await inMcpCall(lastUsedB, async () => {
        const navigation = await helpers.readAppState("navigation");
        const selection =
          await helpers.readAppStateForCurrentTab("design-selection");
        await helpers.writeAppStateForCurrentTab("navigate", { view: "x" });
        await helpers.writeAppState("navigate", { view: "y" });
        return { navigation, selection };
      });

      expect(result.navigation).toEqual({ view: "editor", designId: "b" });
      expect(mockAppStateGet.mock.calls.map((call) => call[1])).toEqual([
        "navigation:tab-b",
        "design-selection:tab-b",
      ]);
      expect(mockAppStatePut.mock.calls.map((call) => call[1])).toEqual([
        "navigate:tab-b",
        "navigate:tab-b",
      ]);
      // Written as the agent, so the tab takes the command as someone else's.
      expect(mockAppStatePut.mock.calls[0]?.[3]).toEqual({
        requestSource: "agent",
      });
    });

    it("doesn't make the call that tab's own", async () => {
      const helpers = await import("./script-helpers.js");

      const { result } = await inMcpCall(lastUsedB, async () => ({
        browserTabId: helpers.getCurrentRequestBrowserTabId(),
        stateTab: await helpers.resolveCurrentRequestStateTab(),
      }));

      expect(result).toEqual({
        browserTabId: null,
        stateTab: { tabId: "tab-b", unavailable: false },
      });
    });

    it("prefers the tab a request came from and never looks one up", async () => {
      const helpers = await import("./script-helpers.js");
      mockAppStateGet.mockResolvedValue(null);

      const { lookups } = await inMcpCall(
        lastUsedB,
        () => helpers.readAppState("navigation"),
        { browserTabId: "tab-a" },
      );

      expect(mockAppStateGet).toHaveBeenCalledWith(
        "alice@test.com",
        "navigation:tab-a",
      );
      expect(lookups).toBe(0);
    });

    it("looks the tab up only for tab-scoped keys", async () => {
      const helpers = await import("./script-helpers.js");
      mockAppStateGet.mockResolvedValue(null);

      const { lookups } = await inMcpCall(lastUsedB, () =>
        helpers.readAppState("design-selection"),
      );

      expect(mockAppStateGet).toHaveBeenCalledWith(
        "alice@test.com",
        "design-selection",
      );
      expect(lookups).toBe(0);
    });

    it("reads no navigation when no tab was used recently, instead of the account-wide row", async () => {
      const helpers = await import("./script-helpers.js");
      mockAppStateGet.mockResolvedValue({ view: "editor", designId: "old" });

      const { result } = await inMcpCall({ kind: "unavailable" }, async () => [
        await helpers.readAppState("navigation"),
        await helpers.readAppStateForCurrentTab("navigation"),
        await helpers.readAppStateForCurrentTab("navigation", {
          fallbackToGlobal: true,
        }),
      ]);

      expect(result).toEqual([null, null, null]);
      expect(mockAppStateGet).not.toHaveBeenCalled();
    });

    it("keeps other keys and every write on the account-wide rows when no tab was used recently", async () => {
      const helpers = await import("./script-helpers.js");
      mockAppStateGet.mockResolvedValue({ designId: "selected" });
      mockAppStatePut.mockResolvedValue(undefined);

      const { result } = await inMcpCall({ kind: "unavailable" }, async () => {
        await helpers.writeAppStateForCurrentTab("navigate", { view: "x" });
        return helpers.readAppStateForCurrentTab("design-selection");
      });

      expect(result).toEqual({ designId: "selected" });
      expect(mockAppStateGet).toHaveBeenCalledWith(
        "alice@test.com",
        "design-selection",
      );
      expect(mockAppStatePut).toHaveBeenCalledWith(
        "alice@test.com",
        "navigate",
        { view: "x" },
        { requestSource: "agent" },
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
