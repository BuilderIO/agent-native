import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAppStatePut = vi.fn();

vi.mock("./store.js", () => ({
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

import { z } from "zod";

import { defineAction } from "../action.js";
import { createNavigateAction } from "../command-navigation/actions.js";
import {
  AgentNavigationRefusedError,
  navigateAfterWrite,
} from "./agent-navigation.js";
import { writeAppState } from "./script-helpers.js";

const isDetailView = (navigation: Record<string, unknown>) =>
  typeof navigation.path === "string" &&
  /^\/tasks\/[^/]+$/.test(navigation.path);

function navigatedPaths(): unknown[] {
  return mockAppStatePut.mock.calls
    .filter(([, key]) => key === "navigate")
    .map(([, , value]) => (value as { path?: unknown }).path);
}

describe("agent navigation keeps the user's view", () => {
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
      ).rejects.toBeInstanceOf(AgentNavigationRefusedError);
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

  it("refuses a navigate write from a read-only action an agent called", async () => {
    const getTask = defineAction({
      description: "Read a task.",
      schema: z.object({ id: z.string() }),
      readOnly: true,
      run: async ({ id }) => {
        await writeAppState("navigate", { path: `/tasks/${id}` });
        return { id };
      },
    });
    await expect(getTask.run({ id: "t1" }, { caller: "mcp" })).rejects.toThrow(
      /read-only action cannot move the user's view/,
    );
    expect(navigatedPaths()).toEqual([]);
  });

  it("skips a write's follow-up navigation for an agent, keeps it for a person", async () => {
    await expect(
      navigateAfterWrite({ path: "/tasks/t1" }, { ctx: { caller: "mcp" } }),
    ).resolves.toEqual({ navigated: false, reason: "agent-keeps-view" });
    expect(navigatedPaths()).toEqual([]);

    await expect(
      navigateAfterWrite(
        { path: "/tasks/t1" },
        { ctx: { caller: "mcp" }, intent: "open" },
      ),
    ).resolves.toEqual({ navigated: true });
    await expect(
      navigateAfterWrite(
        { path: "/tasks/t2" },
        { ctx: { caller: "frontend" } },
      ),
    ).resolves.toEqual({ navigated: true });
    expect(navigatedPaths()).toEqual(["/tasks/t1", "/tasks/t2"]);
  });
});
