import { EventEmitter } from "node:events";

import { PGlite } from "@electric-sql/pglite";
import { createApp } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
  bootstrap: Promise.resolve(),
  initPromises: [] as Promise<void>[],
  probes: [] as Promise<unknown>[],
  reap: vi.fn<() => Promise<unknown>>(),
  settingsEmitter: null as EventEmitter | null,
}));

vi.mock("./framework-request-handler.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./framework-request-handler.js")>();
  return {
    ...actual,
    awaitBootstrap: () => lifecycle.bootstrap,
    getH3App: (nitroApp: any) => nitroApp.h3App,
    markDefaultPluginProvided: vi.fn(),
    trackPluginInit: (_nitroApp: any, promise: Promise<void>) => {
      lifecycle.initPromises.push(promise);
    },
  };
});

vi.mock("../settings/store.js", () => ({
  deleteSetting: vi.fn(async () => false),
  getAllSettings: vi.fn(async () => ({})),
  getSetting: vi.fn(async () => null),
  getSettingsEmitter: () => lifecycle.settingsEmitter,
  putSetting: vi.fn(async () => {}),
}));

vi.mock("../agent/run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/run-store.js")>();
  return {
    ...actual,
    listUnclaimedBackgroundRunRows: vi.fn(async () => []),
    reapAllStaleRuns: () => lifecycle.reap(),
  };
});

vi.mock("../mcp-client/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../mcp-client/index.js")>();
  return {
    ...actual,
    startMcpConfigRefresh: () => {
      const markDirty = () => {};
      const emitter = lifecycle.settingsEmitter!;
      emitter.on("settings", markDirty);
      const timer = setInterval(() => {}, 5_000);
      return () => {
        clearInterval(timer);
        emitter.off("settings", markDirty);
      };
    },
  };
});

vi.mock("../jobs/scheduler.js", () => ({
  processRecurringJobs: vi.fn(async () => {}),
}));

vi.mock("../triggers/dispatcher.js", () => ({
  initTriggerDispatcher: vi.fn(async () => {}),
}));

vi.mock("../chat-threads/migrations.js", () => ({
  runChatThreadDataMigrations: vi.fn(async () => {}),
}));

vi.mock("./social-og-image.js", () => ({
  createAgentNativeOgImageHandler: () => () => new Response(),
}));

import { createAgentChatPlugin } from "./agent-chat-plugin.js";

interface TestHooks {
  hook(name: string, callback: () => void | Promise<void>): void;
  callHook(name: string): Promise<void>;
}

function createTestHooks(): TestHooks {
  const callbacks = new Map<string, Array<() => void | Promise<void>>>();
  return {
    hook(name, callback) {
      const registered = callbacks.get(name) ?? [];
      registered.push(callback);
      callbacks.set(name, registered);
    },
    async callHook(name) {
      await Promise.all(
        (callbacks.get(name) ?? []).map((callback) => callback()),
      );
    },
  };
}

function startGeneration() {
  const hooks = createTestHooks();
  const nitroApp = { h3App: createApp(), hooks };
  const plugin = createAgentChatPlugin({
    actions: () => ({}),
    a2aAgentDelegation: false,
    frameworkTools: "minimal",
    leanPrompt: true,
    mcp: { enabled: false },
  });
  plugin(nitroApp);
  const initPromise = lifecycle.initPromises.at(-1);
  expect(initPromise).toBeDefined();
  return { initPromise: initPromise!, nitroApp };
}

async function initializeGeneration() {
  const generation = startGeneration();
  await generation.initPromise;
  return generation.nitroApp;
}

describe("agent chat plugin Nitro lifecycle", () => {
  let database: PGlite;
  let releaseTransactions: (() => void) | undefined;
  let transactionGate: Promise<void>;
  let pendingTransactions: number;
  let settledTransactions: number;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AGENT_NATIVE_MCP_CONFIG_REFRESH_MS", "5000");
    lifecycle.bootstrap = Promise.resolve();
    lifecycle.initPromises.length = 0;
    lifecycle.probes.length = 0;
    lifecycle.settingsEmitter = new EventEmitter();
    database = new PGlite();
    pendingTransactions = 0;
    settledTransactions = 0;
    transactionGate = new Promise<void>((resolve) => {
      releaseTransactions = resolve;
    });
    lifecycle.reap.mockReset();
    lifecycle.reap.mockImplementation(() => {
      const probe = (async () => {
        pendingTransactions += 1;
        try {
          await database.transaction(async (tx) => {
            await transactionGate;
            await tx.query("SELECT 1 AS ok");
          });
        } finally {
          pendingTransactions -= 1;
          settledTransactions += 1;
        }
        return { scanned: 0, reaped: 0, failed: 0, truncated: false };
      })();
      lifecycle.probes.push(probe);
      return probe;
    });
  });

  afterEach(async () => {
    vi.clearAllTimers();
    releaseTransactions?.();
    await Promise.allSettled(lifecycle.probes);
    await database.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function startFastSweep(): Promise<void> {
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(lifecycle.reap).toHaveBeenCalled());
  }

  it("keeps repeated init and close equivalent to one live generation", async () => {
    const fresh = await initializeGeneration();
    await startFastSweep();
    expect(pendingTransactions).toBe(1);
    await vi.waitFor(() =>
      expect(lifecycle.settingsEmitter!.listenerCount("settings")).toBe(1),
    );

    releaseTransactions?.();
    await vi.waitFor(() => expect(settledTransactions).toBe(1));
    await fresh.hooks.callHook("close");
    await database.close();

    database = new PGlite();
    pendingTransactions = 0;
    settledTransactions = 0;
    transactionGate = new Promise<void>((resolve) => {
      releaseTransactions = resolve;
    });
    lifecycle.reap.mockClear();
    lifecycle.initPromises.length = 0;
    lifecycle.probes.length = 0;
    lifecycle.settingsEmitter = new EventEmitter();
    vi.clearAllTimers();

    for (let generation = 0; generation < 9; generation += 1) {
      const app = await initializeGeneration();
      await app.hooks.callHook("close");
    }
    await initializeGeneration();
    await startFastSweep();

    const repeatedLifecycle = {
      pendingTransactions,
      settingsListeners: lifecycle.settingsEmitter!.listenerCount("settings"),
    };

    releaseTransactions?.();
    await Promise.allSettled(lifecycle.probes);
    expect(settledTransactions).toBe(repeatedLifecycle.pendingTransactions);
    await expect(database.query("SELECT 1 AS ok")).resolves.toMatchObject({
      rows: [{ ok: 1 }],
    });

    expect(repeatedLifecycle).toEqual({
      pendingTransactions: 1,
      settingsListeners: 1,
    });
  });

  it("cleans resources registered after close races asynchronous initialization", async () => {
    let releaseBootstrap!: () => void;
    lifecycle.bootstrap = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const generation = startGeneration();

    const close = generation.nitroApp.hooks.callHook("close");
    releaseBootstrap();
    await Promise.all([generation.initPromise, close]);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(lifecycle.reap).not.toHaveBeenCalled();
    expect(lifecycle.settingsEmitter!.listenerCount("settings")).toBe(0);
    await expect(database.query("SELECT 1 AS ok")).resolves.toMatchObject({
      rows: [{ ok: 1 }],
    });
  });
});
