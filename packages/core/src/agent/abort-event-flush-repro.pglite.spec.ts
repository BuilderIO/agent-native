import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";

import { createApp, type EventHandler } from "h3";
import { toNodeHandler } from "h3/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";

type WriteGate = { runId: string; entered: () => void; wait: Promise<void> };
const harness = vi.hoisted(() => ({
  init: [] as Promise<void>[],
  close: [] as Array<() => void | Promise<void>>,
  singleGate: null as null | WriteGate,
}));
vi.mock("../server/framework-request-handler.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/framework-request-handler.js")
  >()),
  awaitBootstrap: () => Promise.resolve(),
  getH3App: (app: { h3App: ReturnType<typeof createApp> }) => ({
    use(path: string, handler: EventHandler) {
      app.h3App.all(path.endsWith("/runs") ? `${path}/**` : path, handler);
    },
  }),
  markDefaultPluginProvided: vi.fn(),
  trackPluginInit: (_app: unknown, promise: Promise<void>) =>
    harness.init.push(promise),
}));
vi.mock("./run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-store.js")>();
  return {
    ...actual,
    insertRunEvent: async (
      ...args: Parameters<typeof actual.insertRunEvent>
    ) => {
      const gate = harness.singleGate;
      if (gate?.runId === args[0]) {
        gate.entered();
        await gate.wait;
      }
      return actual.insertRunEvent(...args);
    },
  };
});
vi.mock("../agent/run-ownership.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/run-ownership.js")>()),
  callerHasRunAccess: () => true,
  callerHasThreadAccess: () => true,
}));
vi.mock("../server/agent-run-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/agent-run-context.js")>()),
  resolveAgentRunOwnerContext: async () => ({
    owner: "user@example.com",
    anonymous: false,
  }),
  resolveAgentRunOrgId: async () => undefined,
}));
vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  deleteSetting: async () => false,
  getSetting: async () => null,
  getSettingsEmitter: () => new EventEmitter(),
  putSetting: async () => {},
}));
vi.mock("../server/hosted-harness-policy.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/hosted-harness-policy.js")
  >()),
  loadHostedHarnessConfig: async () => undefined,
}));
vi.mock("../server/action-discovery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/action-discovery.js")>()),
  mergeCoreSharingActions: async () => {},
}));
vi.mock("../server/agent-chat/script-entries.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/agent-chat/script-entries.js")
  >()),
  createAgentEngineScriptEntries: async () => ({}),
  createAgentLoopSettingsScriptEntries: async () => ({}),
}));
vi.mock("../server/agent-chat/run-code-tools.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/agent-chat/run-code-tools.js")
  >()),
  loadRunCodeToolEntries: async () => ({}),
}));
vi.mock("../scripts/dev/index.js", () => ({
  createDevScriptRegistry: async () => ({}),
}));
vi.mock("../a2a/server.js", () => ({ mountA2A: vi.fn() }));
vi.mock("../server/social-og-image.js", () => ({
  createAgentNativeOgImageHandler: () => () => new Response(),
}));
vi.mock("../mcp-client/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp-client/index.js")>()),
  buildMergedConfig: async () => null,
  startMcpConfigRefresh: () => () => {},
}));

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
function getExecutor(): DbExec {
  return {
    async execute(input) {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await pglite.query(input.sql, input.args ?? []);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rowCount ?? 0,
      };
    },
    transaction: (fn) => pglite.transaction((tx) => fn(tx)),
  };
}
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => getExecutor(),
  createDbExec: async () => getExecutor(),
  getMigrationDatabaseUrl: () => "pglite:memory://",
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => true,
  ensureIndexExists: async () => true,
  ensureTableExists: async () => true,
}));
const { startRun } = await import("./run-manager.js");
const { createAgentChatPlugin } =
  await import("../server/agent-chat-plugin.js");
const { ensureRunTables, markRunAborted } = await import("./run-store.js");
let server: Server;
let baseUrl: string;
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function events(runId: string) {
  const result = await pglite.query(
    "SELECT seq, event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq",
    [runId],
  );
  return result.rows.map((row) => ({
    seq: Number(row.seq),
    ...JSON.parse(String(row.event_data)),
  }));
}
function stop(runId: string) {
  return fetch(`${baseUrl}/_agent-native/agent-chat/runs/${runId}/abort`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "user" }),
    signal: AbortSignal.timeout(15_000),
  });
}
beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AGENT_MODE", "production");
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  pglite = await createTestPglite();
  await ensureRunTables();
  const h3App = createApp();
  createAgentChatPlugin({
    actions: () => ({}),
    a2aAgentDelegation: false,
    frameworkTools: "minimal",
    leanPrompt: true,
    mcp: { enabled: false },
  })({
    h3App,
    hooks: {
      hook(name: string, callback: () => void | Promise<void>) {
        if (name === "close") harness.close.push(callback);
      },
    },
  });
  const init = harness.init.at(-1);
  if (!init) throw new Error("Plugin initialization was not registered");
  await init;
  server = createServer(toNodeHandler(h3App));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local port");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);
afterAll(async () => {
  if (server?.listening)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await Promise.all(harness.close.map((close) => close()));
  await pglite?.close();
  vi.unstubAllEnvs();
});

describe("durable abort HTTP responses", () => {
  it("stops a normal run after its text is persisted", async () => {
    const runId = "http-abort-normal";
    const ready = gate();
    const run = startRun(
      runId,
      runId,
      async (send, signal) => {
        await send({ type: "text", text: "saved" });
        ready.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
      undefined,
      { softTimeoutMs: 0, noProgressTimeoutMs: 0, executionLease: true },
    );
    try {
      await ready.promise;
      const response = await stop(runId);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      await run.finalized;
      expect(await events(runId)).toEqual([
        { seq: 0, type: "text", text: "saved" },
        { seq: 1, type: "done", reason: "user" },
      ]);
    } finally {
      if (!run.abort.signal.aborted) run.abort.abort("test-cleanup");
      await run.finalized.catch(() => {});
    }
  });
  it("reports an already lost tool event on HTTP and finalization without undoing a durable abort", async () => {
    const runId = "single-abort-terminal";
    const entered = gate();
    const write = gate();
    const driver = gate();
    harness.singleGate = {
      runId,
      entered: entered.resolve,
      wait: write.promise,
    };
    let publication: Promise<void> | undefined;
    const run = startRun(
      runId,
      runId,
      async (send) => {
        publication = send({ type: "tool_start", tool: "read", input: {} });
        void publication.catch(() => {});
        await driver.promise;
      },
      undefined,
      { softTimeoutMs: 0, noProgressTimeoutMs: 0, executionLease: true },
    );
    const finalization = run.finalized.catch((error: unknown) => error);
    try {
      await entered.promise;
      await markRunAborted(runId, "other-worker");
      const drain = run.flushEvents();
      write.resolve();
      await expect(drain).rejects.toMatchObject({
        name: "AgentRunEventNotPersistedError",
        terminalRun: true,
      });
      await expect(publication).rejects.toMatchObject({
        name: "AgentRunEventNotPersistedError",
        terminalRun: true,
      });
      expect((await stop(runId)).status).toBe(500);
      driver.resolve();
      expect(await finalization).toMatchObject({
        name: "AgentRunEventNotPersistedError",
        terminalRun: true,
      });
      expect(await events(runId)).toEqual([
        expect.objectContaining({
          seq: 0,
          type: "error",
          errorCode: "aborted_other-worker",
        }),
      ]);
      const state = await pglite.query(
        "SELECT status FROM agent_runs WHERE id = ?",
        [runId],
      );
      expect(state.rows[0]).toMatchObject({ status: "aborted" });
    } finally {
      write.resolve();
      driver.resolve();
      if (!run.abort.signal.aborted) run.abort.abort("test-cleanup");
      await finalization;
      harness.singleGate = null;
    }
  });
});
