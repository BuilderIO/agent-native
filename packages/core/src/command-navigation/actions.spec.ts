import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mockAppStatePut = vi.fn();
const mockAppStateGet = vi.fn<() => Promise<Record<string, unknown> | null>>(
  async () => null,
);

vi.mock("../application-state/store.js", () => ({
  appStateGet: (...args: unknown[]) => mockAppStateGet(...(args as [])),
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

import { defineAction } from "../action.js";
import { createNavigateAction } from "./actions.js";

function navigatedPaths(): unknown[] {
  return mockAppStatePut.mock.calls
    .filter(([, key]) => String(key).startsWith("navigate"))
    .map(([, , value]) => (value as { path?: unknown }).path);
}

describe("createNavigateAction keeps the user's view by default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppStateGet.mockResolvedValue({ view: "tasks", path: "/tasks" });
    process.env.AGENT_USER_EMAIL = "person@example.com";
  });

  const navigate = createNavigateAction();

  it.each(["tool", "mcp", "webmcp", "a2a"] as const)(
    "keeps the current view and returns a typed result for %s detail navigation without an open intent",
    async (caller) => {
      const result = await navigate.run({ path: "/tasks/t1" }, { caller });
      expect(result).toMatchObject({
        kept: true,
        navigated: false,
        reason: "detail-requires-open-intent",
        currentView: { view: "tasks", path: "/tasks" },
        message: expect.stringContaining('intent: "open"'),
      });
      expect(result).not.toBeInstanceOf(Error);
      expect(navigatedPaths()).toEqual([]);
    },
  );

  it("keeps the current view and returns a typed result even for a list view during an edit without intent open", async () => {
    const editAction = defineAction({
      description: "Edit an item and try to navigate.",
      schema: z.object({}),
      run: async (_args, ctx) => {
        return await navigate.run({ path: "/tasks" }, ctx);
      },
    });
    await expect(editAction.run({}, { caller: "mcp" })).resolves.toMatchObject({
      kept: true,
      navigated: false,
      reason: "write-keeps-view",
      currentView: { view: "tasks", path: "/tasks" },
    });
    expect(navigatedPaths()).toEqual([]);
  });

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
