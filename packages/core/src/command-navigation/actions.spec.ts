import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAppStatePut = vi.fn();

vi.mock("../application-state/store.js", () => ({
  appStateGet: vi.fn(async () => null),
  appStatePut: (...args: unknown[]) => mockAppStatePut(...args),
  appStateDelete: vi.fn(),
  appStateCompareAndSet: vi.fn(async () => true),
  appStateCompareAndSetMany: vi.fn(async () => true),
  appStateList: vi.fn(async () => []),
  appStateDeleteByPrefix: vi.fn(async () => 0),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: vi.fn() }),
  isLocalDatabase: () => true,
}));

import { AgentNavigationRefusedError } from "../application-state/agent-navigation.js";
import { createNavigateAction } from "./actions.js";

const isDetailView = (navigation: Record<string, unknown>) =>
  typeof navigation.path === "string" &&
  /^\/tasks\/[^/]+$/.test(navigation.path);

function navigatedPaths(): unknown[] {
  return mockAppStatePut.mock.calls
    .filter(([, key]) => String(key).startsWith("navigate"))
    .map(([, , value]) => (value as { path?: unknown }).path);
}

describe("createNavigateAction keeps the user's view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_USER_EMAIL = "person@example.com";
  });

  const navigate = createNavigateAction({ isDetailView });

  it.each(["tool", "mcp", "webmcp", "a2a"] as const)(
    "refuses a %s detail navigation without an open intent",
    async (caller) => {
      await expect(
        navigate.run({ path: "/tasks/t1" }, { caller }),
      ).rejects.toThrow(AgentNavigationRefusedError);
      await expect(
        navigate.run({ path: "/tasks/t1" }, { caller }),
      ).rejects.toMatchObject({
        name: "AgentNavigationRefusedError",
        code: "agent_navigation_refused",
        message: expect.stringContaining('intent: "open"'),
      });
      expect(navigatedPaths()).toEqual([]);
    },
  );

  it("opens a detail view when the agent passes intent open", async () => {
    await navigate.run(
      { path: "/tasks/t1", intent: "open" },
      { caller: "mcp" },
    );
    expect(navigatedPaths()).toEqual(["/tasks/t1"]);
    const [, , value] = mockAppStatePut.mock.calls[0];
    expect(value).not.toHaveProperty("intent");
  });

  it("lets an agent go to a list view and a person open a detail", async () => {
    await navigate.run({ path: "/tasks" }, { caller: "mcp" });
    await navigate.run({ path: "/tasks/t1" }, { caller: "frontend" });
    expect(navigatedPaths()).toEqual(["/tasks", "/tasks/t1"]);
  });
});
