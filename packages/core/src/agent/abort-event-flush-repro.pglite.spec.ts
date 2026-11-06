import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";

import { createApp, type EventHandler } from "h3";
import { toNodeHandler } from "h3/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";

const harness = vi.hoisted(() => ({
  init: [] as Promise<void>[],
  close: [] as Array<() => void | Promise<void>>,
  captured: [] as Array<{ error: unknown; phase?: string }>,
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
  trackPluginInit: (_app: unknown, promise: Promise<void>) => {
    harness.init.push(promise);
  },
}));
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
vi.mock("../server/capture-error.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/capture-error.js")>();
  return {
    ...actual,
    captureError: (...args: Parameters<typeof actual.captureError>) => {
      harness.captured.push({ error: args[0], phase: args[1]?.tags?.phase });
      return actual.captureError(...args);
    },
  };
});
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
const {
  ensureRunTables,
  markRunAborted,
  insertRun,
  claimTurnExecutionLease,
  isTurnAborted,
  AgentRunEventNotPersistedError,
} = await import("./run-store.js");
let server: Server;
let baseUrl: string;

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

describe("abort with a queued, fenced event", () => {
  it("reports a lost event when its terminal drain failed before the POST", async () => {
    const runId = "flush-repro-completed-terminal-drain";
    const threadId = "flush-repro-thread-completed-terminal-drain";
    const entered = gate();
    const eventGate = gate();
    const driverGate = gate();
    let publication: Promise<void> | undefined;
    const run = startRun(
      runId,
      threadId,
      async (send) => {
        publication = send({ type: "text", text: "lost-before-stop" });
        void publication.catch(() => {});
        await driverGate.promise;
      },
      undefined,
      {
        softTimeoutMs: 0,
        noProgressTimeoutMs: 0,
        executionLease: true,
        persistEvent: async (write) => {
          entered.resolve();
          await eventGate.promise;
          await write();
        },
      },
    );
    try {
      await entered.promise;
      if (!publication || !run.flushEvents) {
        throw new Error("Run did not start event persistence");
      }
      await markRunAborted(runId, "other-worker");
      const failedDrain = run.flushEvents();
      eventGate.resolve();
      await expect(failedDrain).rejects.toMatchObject({
        name: "AgentRunEventNotPersistedError",
        terminalRun: true,
        cause: expect.objectContaining({
          name: "StaleExecutionFenceError",
          message: expect.stringContaining("generation 1"),
        }),
      });
      await expect(publication).rejects.toBeInstanceOf(
        AgentRunEventNotPersistedError,
      );
      harness.captured.length = 0;
      const response = await fetch(
        `${baseUrl}/_agent-native/agent-chat/runs/${runId}/abort`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "user" }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const events = await pglite.query(
        "SELECT seq, event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq",
        [runId],
      );
      expect(
        events.rows.map((row) => JSON.parse(String(row.event_data))),
      ).toEqual([
        expect.objectContaining({
          type: "error",
          errorCode: "aborted_other-worker",
        }),
      ]);
      expect(response.status).toBe(500);
      expect(harness.captured).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            phase: "abort-run",
            error: expect.objectContaining({
              name: "AgentRunEventNotPersistedError",
              terminalRun: true,
            }),
          }),
        ]),
      );
      await expect(run.flushEvents()).rejects.toBeInstanceOf(
        AgentRunEventNotPersistedError,
      );
    } finally {
      eventGate.resolve();
      driverGate.resolve();
      if (!run.abort.signal.aborted) run.abort.abort("test-cleanup");
      await run.finalized.catch(() => {});
    }
  });
  it("waits for a queued event when the abort signal terminates the driver", async () => {
    const runId = "flush-repro-signal";
    const threadId = "flush-repro-thread-signal";
    const entered = gate();
    const eventGate = gate();
    const driverExited = gate();
    const order: string[] = [];
    harness.captured.length = 0;
    const run = startRun(
      runId,
      threadId,
      async (send, signal) => {
        void send({ type: "text", text: "queued-signal" }).catch(() => {});
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              order.push("signal");
              resolve();
            },
            { once: true },
          );
        });
        order.push("driver-exited");
        driverExited.resolve();
      },
      undefined,
      {
        softTimeoutMs: 0,
        noProgressTimeoutMs: 0,
        executionLease: true,
        persistEvent: async (write) => {
          order.push("write-gated");
          entered.resolve();
          await eventGate.promise;
          order.push("write-started");
          await write();
          order.push("write-completed");
        },
      },
    );
    let finalized = false;
    void run.finalized.then(
      () => {
        finalized = true;
        order.push("finalized");
      },
      () => {
        finalized = true;
        order.push("finalized-error");
      },
    );
    try {
      await entered.promise;
      const flushSpy = vi.spyOn(run, "flushEvents");
      const stop = fetch(
        `${baseUrl}/_agent-native/agent-chat/runs/${runId}/abort`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "user" }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      await driverExited.promise;
      await vi.waitFor(() => expect(flushSpy).toHaveBeenCalledTimes(2));
      const before = await pglite.query(
        "SELECT r.status, l.generation, l.owner_run_id, l.lease_expires_at > clock_timestamp() AS lease_is_live FROM agent_runs r JOIN agent_execution_leases l ON l.thread_id = r.thread_id AND l.turn_id = r.turn_id WHERE r.id = ?",
        [runId],
      );
      expect(before.rows[0]).toMatchObject({
        status: "running",
        owner_run_id: runId,
        lease_is_live: true,
      });
      expect(finalized).toBe(false);
      order.push("observed-live-lease");
      eventGate.resolve();
      const response = await stop;
      const body = await response.text();
      order.push(`http-${response.status}`);
      await run.finalized;
      const after = await pglite.query(
        "SELECT r.status, l.generation, l.lease_expires_at > clock_timestamp() AS lease_is_live FROM agent_runs r JOIN agent_execution_leases l ON l.thread_id = r.thread_id AND l.turn_id = r.turn_id WHERE r.id = ?",
        [runId],
      );
      const events = await pglite.query(
        "SELECT seq, event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq",
        [runId],
      );
      expect(order.slice(0, 5)).toEqual([
        "write-gated",
        "signal",
        "driver-exited",
        "observed-live-lease",
        "write-started",
      ]);
      expect(order.indexOf("write-completed")).toBeLessThan(
        order.indexOf("finalized"),
      );
      expect(String(before.rows[0]?.generation)).toBe("1");
      expect(response.status).toBe(200);
      expect(JSON.parse(body)).toEqual({ ok: true });
      expect(after.rows[0]).toMatchObject({
        status: "aborted",
        lease_is_live: false,
      });
      expect(
        events.rows.map((row) => ({
          seq: Number(row.seq),
          ...JSON.parse(String(row.event_data)),
        })),
      ).toEqual([
        { seq: 0, type: "text", text: "queued-signal" },
        { seq: 1, type: "done", reason: "user" },
      ]);
      expect(
        harness.captured.filter(({ phase }) => phase === "abort-event-flush"),
      ).toEqual([]);
    } finally {
      eventGate.resolve();
      if (!run.abort.signal.aborted) run.abort.abort("test-cleanup");
      await run.finalized.catch(() => {});
    }
  });
  for (const mode of ["current", "expired", "reclaimed", "terminal"] as const) {
    it(mode, async () => {
      const runId = `flush-repro-${mode}`;
      const threadId = `flush-repro-thread-${mode}`;
      const entered = gate();
      const eventGate = gate();
      const driverGate = gate();
      const run = startRun(
        runId,
        threadId,
        async (send) => {
          void send({ type: "text", text: `queued-${mode}` }).catch(() => {});
          await driverGate.promise;
        },
        undefined,
        {
          softTimeoutMs: 0,
          noProgressTimeoutMs: 0,
          executionLease: true,
          persistEvent: async (write) => {
            entered.resolve();
            await eventGate.promise;
            await write();
          },
        },
      );
      try {
        await entered.promise;
        if (mode === "expired" || mode === "reclaimed") {
          await pglite.query(
            "UPDATE agent_execution_leases SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE thread_id = ? AND turn_id = ?",
            [threadId, runId],
          );
        }
        if (mode === "reclaimed") {
          const successorId = `${runId}-successor`;
          await insertRun(successorId, threadId, runId);
          await claimTurnExecutionLease(threadId, runId, successorId);
        }
        if (mode === "terminal") await markRunAborted(runId, "other-worker");
        harness.captured.length = 0;
        const flushSpy = vi.spyOn(run, "flushEvents");
        const abortReached = new Promise<void>((resolve) =>
          run.abort.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
        const stop = fetch(
          `${baseUrl}/_agent-native/agent-chat/runs/${runId}/abort`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason: "user" }),
            signal: AbortSignal.timeout(15_000),
          },
        );
        await Promise.race([
          abortReached,
          stop.then((response) => {
            throw new Error(
              `POST returned ${response.status} before aborting the active run`,
            );
          }),
        ]);
        await vi.waitFor(() => expect(flushSpy).toHaveBeenCalledTimes(2));
        eventGate.resolve();
        const response = await stop;
        const body = await response.text();
        const result = { status: response.status, body };
        const state = await pglite.query(
          "SELECT id, status, dispatch_mode, terminal_reason FROM agent_runs WHERE thread_id = ? ORDER BY id",
          [threadId],
        );
        const events = await pglite.query(
          "SELECT seq, event_data FROM agent_run_events WHERE run_id = ? ORDER BY seq",
          [runId],
        );
        const eventSummary = events.rows.map((row) => {
          const event = JSON.parse(String(row.event_data)) as {
            type?: string;
            errorCode?: string;
            text?: string;
          };
          return {
            seq: Number(row.seq),
            type: event.type,
            errorCode: event.errorCode,
            text: event.text,
          };
        });
        const turnAborted = await isTurnAborted(threadId, runId);
        const textPersisted = events.rows.some((event) =>
          String(event.event_data).includes(`queued-${mode}`),
        );
        const statuses = state.rows.map((row) => ({
          id: row.id,
          status: row.status,
          dispatch_mode: row.dispatch_mode,
        }));
        if (mode === "current") {
          expect(result.status).toBe(200);
          expect(JSON.parse(result.body)).toEqual({ ok: true });
          expect(textPersisted).toBe(true);
          expect(eventSummary).toEqual([
            {
              seq: 0,
              type: "text",
              errorCode: undefined,
              text: "queued-current",
            },
            { seq: 1, type: "done", errorCode: undefined, text: undefined },
          ]);
          expect(statuses[0]).toMatchObject({ status: "aborted" });
        } else if (mode === "expired" || mode === "reclaimed") {
          expect(result.status).toBe(500);
          expect(
            harness.captured.some(
              ({ error, phase }) =>
                phase === "abort-event-flush" &&
                error instanceof Error &&
                error.name === "StaleExecutionFenceError",
            ),
          ).toBe(true);
          expect(eventSummary).toEqual([]);
          expect(statuses[0]).toMatchObject({ status: "running" });
          expect(textPersisted).toBe(false);
          expect(turnAborted).toBe(false);
        } else {
          expect(result.status).toBe(500);
          expect(
            harness.captured.some(
              ({ error, phase }) =>
                phase === "abort-event-flush" &&
                error instanceof AgentRunEventNotPersistedError &&
                error.terminalRun &&
                error.cause instanceof Error &&
                error.cause.name === "StaleExecutionFenceError",
            ),
          ).toBe(true);
          expect(
            harness.captured.some(
              ({ error, phase }) =>
                phase === "abort-run" &&
                error instanceof AgentRunEventNotPersistedError &&
                error.terminalRun &&
                error.cause instanceof Error &&
                error.cause.name === "StaleExecutionFenceError",
            ),
          ).toBe(true);
          expect(eventSummary).toEqual([
            {
              seq: 0,
              type: "error",
              errorCode: "aborted_other-worker",
              text: undefined,
            },
          ]);
          expect(statuses[0]).toMatchObject({ status: "aborted" });
          expect(textPersisted).toBe(false);
        }
        driverGate.resolve();
        await run.finalized.catch(() => {});
        const finalState = await pglite.query(
          "SELECT id, status FROM agent_runs WHERE thread_id = ? ORDER BY id",
          [threadId],
        );
        const finalTurnAborted = await isTurnAborted(threadId, runId);
        if (mode === "expired" || mode === "reclaimed") {
          expect(finalState.rows[0]).toMatchObject({ status: "running" });
          expect(finalTurnAborted).toBe(false);
        }
      } finally {
        eventGate.resolve();
        driverGate.resolve();
        if (!run.abort.signal.aborted) run.abort.abort("test-cleanup");
        await run.finalized.catch(() => {});
      }
    });
  }
});
