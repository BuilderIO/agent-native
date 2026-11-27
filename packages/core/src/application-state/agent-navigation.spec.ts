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
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => ({ execute: vi.fn() }),
  isLocalDatabase: () => true,
}));

import { z } from "zod";

import { defineAction } from "../action.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  assertAgentNavigationAllowed,
  navigateAfterWrite,
} from "./agent-navigation.js";

function navigatedPaths(): unknown[] {
  return mockAppStatePut.mock.calls
    .filter(([, key]) => String(key).startsWith("navigate"))
    .map(([, , value]) => (value as { path?: unknown }).path);
}

function inTab<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    {
      userEmail: "person@example.com",
      run: { browserTabId: "tab-1" },
    },
    fn,
  );
}

describe("agent navigation keeps the user's view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_USER_EMAIL = "person@example.com";
  });

  it("skips a write's follow-up navigation for an agent, keeps it for a person", async () => {
    await expect(
      inTab(() =>
        navigateAfterWrite({ path: "/tasks/t1" }, { ctx: { caller: "mcp" } }),
      ),
    ).resolves.toMatchObject({
      navigated: false,
      kept: true,
      reason: "navigation-mode-keep",
      tabId: "tab-1",
      resolvedUrl: "/tasks/t1",
    });
    expect(navigatedPaths()).toEqual([]);

    await expect(
      inTab(() =>
        navigateAfterWrite(
          { path: "/tasks/t1" },
          { ctx: { caller: "mcp" }, intent: "open" },
        ),
      ),
    ).resolves.toEqual({
      navigated: true,
      kept: false,
      tabId: "tab-1",
      resolvedUrl: "/tasks/t1",
      writeId: expect.any(String),
    });
    await expect(
      inTab(() =>
        navigateAfterWrite(
          { path: "/tasks/t2" },
          { ctx: { caller: "frontend" } },
        ),
      ),
    ).resolves.toEqual({
      navigated: true,
      kept: false,
      tabId: "tab-1",
      resolvedUrl: "/tasks/t2",
      writeId: expect.any(String),
    });
    expect(navigatedPaths()).toEqual(["/tasks/t1", "/tasks/t2"]);
  });

  it("says no tab moved when a call from no tab finds none or has no tab slot", async () => {
    const unavailableResult = await runWithRequestContext(
      {
        userEmail: "person@example.com",
        run: {
          browserTabTarget: {
            resolve: async () => ({ kind: "unavailable" as const }),
          },
        },
      },
      () =>
        navigateAfterWrite(
          { path: "/tasks/t1" },
          { ctx: { caller: "frontend" } },
        ),
    );
    expect(unavailableResult).toEqual({
      navigated: false,
      kept: true,
      reason: "no-tab",
      tabId: null,
      resolvedUrl: "/tasks/t1",
    });

    const noSlotResult = await runWithRequestContext(
      { userEmail: "person@example.com" },
      () =>
        navigateAfterWrite(
          { path: "/tasks/t1" },
          { ctx: { caller: "a2a" }, intent: "open" },
        ),
    );
    expect(noSlotResult).toEqual({
      navigated: false,
      kept: true,
      reason: "no-tab",
      tabId: null,
      resolvedUrl: "/tasks/t1",
    });
    expect(navigatedPaths()).toEqual([]);
  });

  it("refuses non-navigate write actions in assertAgentNavigationAllowed even for non-detail targets", async () => {
    const customWrite = defineAction({
      description: "Custom write action calling assertAgentNavigationAllowed.",
      schema: z.object({}),
      run: async (_args, ctx) => {
        assertAgentNavigationAllowed({ view: "tasks" }, { ctx });
      },
    });
    await expect(
      customWrite.run({}, { caller: "mcp", actionName: "edit-task" }),
    ).rejects.toMatchObject({
      name: "AgentNavigationRefusedError",
      code: "agent_navigation_refused",
      reason: "write-keeps-view",
    });

    const standaloneNav = defineAction({
      description: "Standalone navigate calling assertAgentNavigationAllowed.",
      schema: z.object({}),
      run: async (_args, ctx) => {
        assertAgentNavigationAllowed({ view: "tasks" }, { ctx });
        return { ok: true };
      },
    });
    await expect(
      standaloneNav.run({}, { caller: "mcp", actionName: "navigate" }),
    ).resolves.toEqual({ ok: true });
  });
});
