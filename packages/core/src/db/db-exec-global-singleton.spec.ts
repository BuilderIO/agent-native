import { describe, it, expect, vi, afterEach } from "vitest";

// Vite dev evaluates @agent-native/core once per module runner ("nitro" and
// "ssr"), so the singleton exec these tests protect must live on globalThis,
// not a module-scoped `let`. vi.resetModules() gives a fresh module instance
// backed by the same globalThis, which is exactly that situation.

describe("getDbExec singleton across module reloads", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("./client.js");
    await closeDbExec();
    Reflect.deleteProperty(globalThis as object, "__agentNativeDbExecState");
    Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessLocks",
    );
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessExitCleanupRegistered",
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns the same initialized DbExec from a reloaded module instance", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const a = await import("./client.js");
    // Trigger lazy init so the singleton is actually assigned.
    await a.getDbExec().execute("SELECT 1");
    const execA = a.getDbExec();

    vi.resetModules();

    const b = await import("./client.js");
    const execB = b.getDbExec();

    expect(execB).toBe(execA);
  });
});
