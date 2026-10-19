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

  describe("turn screen snapshot", () => {
    const sentScreen = () => ({
      source: "message" as const,
      snapshot: {
        v: 1 as const,
        browserTabId: "tab-a",
        capturedAt: 1,
        values: {
          navigation: { view: "editor", slideIndex: 1 },
          selection: null,
          "slides-selection": { slideId: "slide-2" },
        },
      },
    });

    async function inTurn<T>(
      turnScreen: ReturnType<typeof sentScreen>,
      fn: (helpers: typeof import("./script-helpers.js")) => Promise<T>,
    ): Promise<T> {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const helpers = await import("./script-helpers.js");
      const { runWithRequestContext } =
        await import("../server/request-context.js");
      return runWithRequestContext(
        {
          userEmail: "alice@test.com",
          run: { browserTabId: "tab-a", turnScreen },
        },
        () => fn(helpers),
      ) as Promise<T>;
    }

    it("returns the sent values however the key is spelled, without reading live state", async () => {
      mockAppStateGet.mockResolvedValue({ view: "editor", slideIndex: 4 });

      const reads = await inTurn(sentScreen(), async (helpers) => [
        await helpers.readAppState("navigation"),
        await helpers.readAppStateForCurrentTab("navigation"),
        await helpers.readAppState("slides-selection:tab-a"),
        await helpers.readAppStateForCurrentTab("selection", {
          fallbackToGlobal: true,
        }),
      ]);

      expect(reads).toEqual([
        { view: "editor", slideIndex: 1 },
        { view: "editor", slideIndex: 1 },
        { slideId: "slide-2" },
        null,
      ]);
      expect(mockAppStateGet).not.toHaveBeenCalled();
    });

    it("reads keys outside the snapshot and other tabs live", async () => {
      mockAppStateGet.mockResolvedValue({ live: true });

      const reads = await inTurn(sentScreen(), async (helpers) => [
        await helpers.readAppState("slides-panels:tab-a"),
        await helpers.readAppState("navigation:tab-b"),
      ]);

      expect(reads).toEqual([{ live: true }, { live: true }]);
      expect(mockAppStateGet).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["a navigate command", "navigate"],
      ["a URL command", "__set_url__"],
      ["a pinned key", "selection"],
    ])(
      "reads live state after the turn writes %s",
      async (_label, writtenKey) => {
        mockAppStatePut.mockResolvedValue(undefined);
        mockAppStateGet.mockResolvedValue({ view: "editor", slideIndex: 4 });
        const turnScreen = sentScreen();

        const navigation = await inTurn(turnScreen, async (helpers) => {
          await helpers.writeAppStateForCurrentTab(writtenKey, { view: "x" });
          return helpers.readAppState("navigation");
        });

        expect(navigation).toEqual({ view: "editor", slideIndex: 4 });
        expect(turnScreen.snapshot).toMatchObject({ released: true });
        expect(mockAppStatePut).toHaveBeenCalledWith(
          "alice@test.com",
          "turn-screen-released:tab-a",
          { capturedAt: 1 },
          { requestSource: "agent" },
        );
      },
    );

    it("recognizes a snapshot an earlier segment released", async () => {
      process.env.AGENT_USER_EMAIL = "alice@test.com";
      const { wasTurnScreenReleased } = await import("./script-helpers.js");
      mockAppStateGet.mockResolvedValue({ capturedAt: 1 });
      const { snapshot } = sentScreen();

      expect(await wasTurnScreenReleased(snapshot)).toBe(true);
      expect(await wasTurnScreenReleased({ ...snapshot, capturedAt: 2 })).toBe(
        false,
      );
      expect(mockAppStateGet).toHaveBeenCalledWith(
        "alice@test.com",
        "turn-screen-released:tab-a",
      );
    });

    it.each([
      ["covers a pinned key", "slides-", 1, true],
      ["covers a navigation command", "nav", 1, true],
      ["misses the screen", "compose-", 1, false],
      ["deletes nothing", "slides-", 0, false],
    ])(
      "handles a prefix delete that %s",
      async (_label, prefix, deleted, releases) => {
        mockAppStateDeleteByPrefix.mockResolvedValue(deleted);
        mockAppStatePut.mockResolvedValue(undefined);
        const turnScreen = sentScreen();

        await inTurn(turnScreen, (helpers) =>
          helpers.deleteAppStateByPrefix(prefix),
        );

        expect(turnScreen.snapshot.released === true).toBe(releases);
      },
    );

    it("keeps the snapshot when the turn writes unrelated state", async () => {
      mockAppStatePut.mockResolvedValue(undefined);
      const turnScreen = sentScreen();

      const navigation = await inTurn(turnScreen, async (helpers) => {
        await helpers.writeAppStateForCurrentTab("slides-panels", { a: 1 });
        return helpers.readAppState("navigation");
      });

      expect(navigation).toEqual({ view: "editor", slideIndex: 1 });
      expect(turnScreen.snapshot).not.toHaveProperty("released");
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
