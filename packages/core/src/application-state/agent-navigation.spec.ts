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

import { runWithRequestContext } from "../server/request-context.js";
import { navigateAfterWrite } from "./agent-navigation.js";

function navigatedPaths(): unknown[] {
  return mockAppStatePut.mock.calls
    .filter(([, key]) => String(key).startsWith("navigate"))
    .map(([, , value]) => (value as { path?: unknown }).path);
}

describe("agent navigation keeps the user's view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_USER_EMAIL = "person@example.com";
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

  it("says no tab moved when a call from no tab finds none", async () => {
    const result = await runWithRequestContext(
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
    expect(result).toEqual({ navigated: false, reason: "no-tab" });
    expect(navigatedPaths()).toEqual([]);
  });
});
