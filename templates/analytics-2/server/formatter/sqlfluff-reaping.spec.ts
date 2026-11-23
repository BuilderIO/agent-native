/**
 * Child-reaping regression coverage.
 *
 * Only the external transport seam (`node:child_process`) is replaced with an
 * EventEmitter child. The production helper's queue, request ids, deadlines,
 * stop flags and exact-child reaping run unchanged. No test-only production
 * export, injection hook or process-wide kill is introduced.
 */
import { EventEmitter } from "node:events";

import { beforeEach, expect, it, vi } from "vitest";

type Responder = (request: Record<string, unknown>) => unknown;

const control = vi.hoisted(() => ({
  children: [] as unknown[],
  spawnCount: 0,
}));

vi.mock("node:child_process", () => ({
  spawn: () => {
    control.spawnCount += 1;
    return control.children.shift();
  },
}));

const CONFIG = "[sqlfluff]\ndialect = bigquery\ntemplater = raw\n";
const SOURCE = "select 1 as value";

type KillBehaviour = "exit" | "throw" | "refuse" | "throw-then-exit";
type Behaviour = {
  kill: KillBehaviour;
  disconnectThrows?: boolean;
  alreadyExited?: boolean;
};

function makeFakeChild(behaviour: Behaviour) {
  const emitter = new EventEmitter();
  const state = {
    exitCode: behaviour.alreadyExited ? 0 : (null as number | null),
    signalCode: null as NodeJS.Signals | null,
  };
  Object.defineProperty(emitter, "exitCode", { get: () => state.exitCode });
  Object.defineProperty(emitter, "signalCode", { get: () => state.signalCode });
  const killed: string[] = [];
  const requests: Array<Record<string, unknown>> = [];
  const respond: { current: Responder | null } = { current: null };
  const emitExit = (signal: NodeJS.Signals | null) => {
    state.signalCode = signal;
    emitter.emit("exit", null, signal);
  };
  const deliver = (payload: unknown) => {
    emitter.emit("message", payload);
  };
  return Object.assign(emitter, {
    connected: true,
    killed,
    requests,
    respond,
    deliver,
    send(
      message: Record<string, unknown>,
      callback?: (error: Error | null) => void,
    ) {
      requests.push(message);
      const produce = respond.current;
      queueMicrotask(() => {
        try {
          if (produce) deliver(produce(message));
        } finally {
          callback?.(null);
        }
      });
      return true;
    },
    disconnect() {
      if (behaviour.disconnectThrows) throw new Error("disconnect raced");
    },
    kill(signal?: NodeJS.Signals) {
      killed.push(signal ?? "SIGTERM");
      if (behaviour.kill === "throw") throw new Error("kill failed");
      if (behaviour.kill === "throw-then-exit") {
        queueMicrotask(() => emitExit(signal ?? null));
        throw new Error("kill raced with exit");
      }
      if (behaviour.kill === "refuse") return false;
      queueMicrotask(() => emitExit(signal ?? null));
      return true;
    },
  });
}

function queueChild(behaviour: Behaviour) {
  const child = makeFakeChild(behaviour);
  control.children.push(child);
  return child;
}

async function loadRuntime() {
  vi.resetModules();
  return import("./sqlfluff.js");
}

async function waitForRequest(child: {
  requests: Array<Record<string, unknown>>;
}) {
  await vi.waitFor(() => {
    expect(child.requests).toHaveLength(1);
  });
}

beforeEach(() => {
  control.children.length = 0;
  control.spawnCount = 0;
});

it("rejects public stop and stays fail-closed when a throwing kill never proves exit", async () => {
  const child = queueChild({ kill: "throw" });
  const runtime = await loadRuntime();
  child.respond.current = null;
  const pending = runtime.validateSqlFluffConfig(CONFIG);
  await waitForRequest(child);

  const stopped = runtime.stopSqlFluffRuntime();
  await expect(stopped).rejects.toMatchObject({ code: "runtime_error" });
  await expect(stopped).rejects.not.toThrow("kill failed");
  await expect(stopped).rejects.not.toThrow(CONFIG);
  await expect(pending).resolves.toMatchObject({
    valid: false,
    error: { code: "runtime_error" },
  });

  expect(control.spawnCount).toBe(1);
  await expect(
    runtime.formatSqlWithConfig({ config: CONFIG, source: SOURCE }),
  ).rejects.toMatchObject({ code: "runtime_error" });
  await expect(runtime.stopSqlFluffRuntime()).rejects.toMatchObject({
    code: "runtime_error",
  });
  expect(control.spawnCount).toBe(1);
});

it("rejects public stop when its own SIGKILL is refused and no exit is observed", async () => {
  const child = queueChild({ kill: "refuse" });
  const runtime = await loadRuntime();
  child.respond.current = null;
  const pending = runtime.validateSqlFluffConfig(CONFIG);
  await waitForRequest(child);

  await expect(runtime.stopSqlFluffRuntime()).rejects.toMatchObject({
    code: "runtime_error",
  });
  await expect(pending).resolves.toMatchObject({
    valid: false,
    error: { code: "runtime_error" },
  });
  expect(control.spawnCount).toBe(1);
});

it("resolves public stop when its own child independently proves exit", async () => {
  const child = queueChild({ kill: "exit" });
  const runtime = await loadRuntime();
  child.respond.current = null;
  const pending = runtime.validateSqlFluffConfig(CONFIG);
  await waitForRequest(child);

  await expect(runtime.stopSqlFluffRuntime()).resolves.toBeUndefined();
  await expect(pending).resolves.toMatchObject({
    valid: false,
    error: { code: "runtime_error" },
  });
  expect(control.spawnCount).toBe(1);
  await expect(runtime.stopSqlFluffRuntime()).resolves.toBeUndefined();
});

it("does not wait the full reap bound when its own child already exited", async () => {
  const child = queueChild({ kill: "refuse", alreadyExited: true });
  const runtime = await loadRuntime();
  child.respond.current = null;
  const pending = runtime.validateSqlFluffConfig(CONFIG);
  await waitForRequest(child);

  const started = Date.now();
  await expect(runtime.stopSqlFluffRuntime()).resolves.toBeUndefined();
  expect(Date.now() - started).toBeLessThan(1_000);
  await expect(pending).resolves.toMatchObject({
    valid: false,
    error: { code: "runtime_error" },
  });
});

it("treats a throwing disconnect as benign only after the child actually exits", async () => {
  const first = queueChild({ kill: "exit", disconnectThrows: true });
  const second = queueChild({ kill: "exit" });
  const runtime = await loadRuntime();

  first.respond.current = (request) => ({
    id: request.id,
    valid: true,
    error: null,
  });
  await expect(
    runtime.validateSqlFluffConfig(CONFIG, { deadlineMs: 500 }),
  ).resolves.toMatchObject({
    valid: false,
    error: { code: "runtime_error" },
  });

  second.respond.current = (request) => ({
    id: request.id,
    valid: true,
    error: null,
    dialect: "bigquery",
    templater: "raw",
  });
  await expect(runtime.validateSqlFluffConfig(CONFIG)).resolves.toEqual({
    valid: true,
    error: null,
    dialect: "bigquery",
    templater: "raw",
  });
  expect(control.spawnCount).toBe(2);
});

it("treats a throwing kill as benign only after the child actually exits", async () => {
  const first = queueChild({ kill: "throw-then-exit" });
  const second = queueChild({ kill: "exit" });
  const runtime = await loadRuntime();

  first.respond.current = (request) => ({
    id: request.id,
    valid: true,
    error: null,
  });
  await expect(
    runtime.validateSqlFluffConfig(CONFIG, { deadlineMs: 500 }),
  ).resolves.toMatchObject({
    valid: false,
    error: { code: "runtime_error" },
  });

  second.respond.current = (request) => ({
    id: request.id,
    valid: true,
    error: null,
    dialect: "bigquery",
    templater: "raw",
  });
  await expect(runtime.validateSqlFluffConfig(CONFIG)).resolves.toEqual({
    valid: true,
    error: null,
    dialect: "bigquery",
    templater: "raw",
  });
  expect(control.spawnCount).toBe(2);
});

it("does not emit an unhandled rejection when error-listener cleanup cannot prove exit", async () => {
  const child = queueChild({ kill: "throw" });
  const runtime = await loadRuntime();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    child.respond.current = null;
    const pending = runtime.validateSqlFluffConfig(CONFIG);
    await waitForRequest(child);
    child.emit("error", new Error("worker start failed"));

    await expect(runtime.stopSqlFluffRuntime()).rejects.toMatchObject({
      code: "runtime_error",
    });
    await expect(pending).resolves.toMatchObject({
      valid: false,
      error: { code: "runtime_error" },
    });
    expect(unhandled).toEqual([]);
    expect(control.spawnCount).toBe(1);

    await expect(
      runtime.formatSqlWithConfig({ config: CONFIG, source: SOURCE }),
    ).rejects.toMatchObject({ code: "runtime_error" });
    expect(control.spawnCount).toBe(1);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
