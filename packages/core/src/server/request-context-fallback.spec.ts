import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestContextGlobalKeys = [
  "__agentNativeRequestContextAls",
  "__agentNativeRequestContextObservers",
  "__agentNativeRequestContextContinuationLocal",
  "__agentNativeRequestBoundaryInstalled",
] as const;

const globalState = globalThis as Record<string, unknown>;
const savedGlobalState = new Map<
  (typeof requestContextGlobalKeys)[number],
  { exists: boolean; value: unknown }
>();

describe("server/request-context fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of requestContextGlobalKeys) {
      savedGlobalState.set(key, {
        exists: Object.prototype.hasOwnProperty.call(globalState, key),
        value: globalState[key],
      });
      delete globalState[key];
    }
    vi.stubGlobal("window", {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of requestContextGlobalKeys) {
      const saved = savedGlobalState.get(key);
      if (saved?.exists) {
        globalState[key] = saved.value;
      } else {
        delete globalState[key];
      }
    }
    savedGlobalState.clear();
    vi.resetModules();
  });

  it("fails closed for overlapping action-surface requests", async () => {
    const { runWithRequestContext } = await import("./request-context.js");
    const alphaRun = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const betaRun = vi.fn(async () => {
      await Promise.resolve();
    });

    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        runWithRequestContext(
          { run: { allowedActionNames: ["alpha"] } },
          alphaRun,
        ),
      ),
      Promise.resolve().then(() =>
        runWithRequestContext(
          { run: { allowedActionNames: ["beta"] } },
          betaRun,
        ),
      ),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(alphaRun).not.toHaveBeenCalled();
    expect(betaRun).not.toHaveBeenCalled();
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({
          message: expect.stringContaining("continuation-local"),
        });
      }
    }
  });

  it("rejects configured action surfaces before creating a handler", async () => {
    const { createProductionAgentHandler } =
      await import("../agent/production-agent.js");

    expect(() =>
      createProductionAgentHandler({
        systemPrompt: "Test",
        resolveActionSurface: async () => ({ allowedActionNames: [] }),
      }),
    ).toThrow("continuation-local");
  });
});
