/**
 * IPC-boundary regression coverage.
 *
 * These tests replace only the external transport seam (`node:child_process`)
 * with an EventEmitter child. The production helper, queue, deadlines, request
 * ids and child lifecycle all run unchanged. No test-only production export or
 * injection hook is added.
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
const VALIDATE_SUCCESS = {
  valid: true,
  error: null,
  dialect: "bigquery",
  templater: "raw",
};

function makeFakeChild() {
  const emitter = new EventEmitter();
  const killed: string[] = [];
  const listenerErrors: unknown[] = [];
  const requests: Array<Record<string, unknown>> = [];
  const respond: { current: Responder | null } = { current: null };
  const deliver = (payload: unknown) => {
    try {
      emitter.emit("message", payload);
    } catch (error) {
      // Preserve the test process while recording that production let an
      // exception escape its message listener.
      listenerErrors.push(error);
    }
  };
  return Object.assign(emitter, {
    connected: true,
    killed,
    listenerErrors,
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
        } catch (error) {
          listenerErrors.push(error);
        } finally {
          callback?.(null);
        }
      });
      return true;
    },
    disconnect() {
      // The fake has no OS transport to close.
    },
    kill(signal?: NodeJS.Signals) {
      killed.push(signal ?? "SIGTERM");
      queueMicrotask(() => {
        emitter.emit("exit", null, signal ?? null);
      });
      return true;
    },
  });
}

function queueChild() {
  const child = makeFakeChild();
  control.children.push(child);
  return child;
}

async function loadRuntime() {
  vi.resetModules();
  return import("./sqlfluff.js");
}

beforeEach(() => {
  control.children.length = 0;
  control.spawnCount = 0;
});

it("rejects a validation success that omits the required dialect and templater", async () => {
  const child = queueChild();
  child.respond.current = (request) => ({
    id: request.id,
    valid: true,
    error: null,
  });
  const runtime = await loadRuntime();

  const result = await runtime.validateSqlFluffConfig(CONFIG, {
    deadlineMs: 500,
  });

  expect(child.listenerErrors).toEqual([]);
  expect(result).toEqual({
    valid: false,
    error: {
      code: "runtime_error",
      message: "SQLFluff returned an invalid response.",
    },
  });
  expect(child.killed).toContain("SIGKILL");
});

it("turns a null worker message into a typed runtime error without throwing in the listener", async () => {
  const child = queueChild();
  child.respond.current = () => null;
  const runtime = await loadRuntime();

  const result = await runtime.validateSqlFluffConfig(CONFIG, {
    deadlineMs: 500,
  });

  expect(child.listenerErrors).toEqual([]);
  expect(result).toMatchObject({
    valid: false,
    error: { code: "runtime_error" },
  });
  expect(child.killed).toContain("SIGKILL");
});

it("does not coerce a missing format changed flag into a no-op success", async () => {
  const child = queueChild();
  child.respond.current = (request) => ({
    id: request.id,
    valid: true,
    error: null,
    formattedSource: "SELECT 1\n",
    dialect: "bigquery",
    templater: "raw",
  });
  const runtime = await loadRuntime();

  await expect(
    runtime.formatSqlWithConfig({
      config: CONFIG,
      source: SOURCE,
      deadlineMs: 500,
    }),
  ).rejects.toMatchObject({ code: "runtime_error" });

  expect(child.listenerErrors).toEqual([]);
  expect(child.killed).toContain("SIGKILL");
});

it("rejects a format success without formattedSource and reaps the child", async () => {
  const child = queueChild();
  child.respond.current = (request) => ({
    id: request.id,
    valid: true,
    error: null,
    changed: true,
    dialect: "bigquery",
    templater: "raw",
  });
  const runtime = await loadRuntime();

  await expect(
    runtime.formatSqlWithConfig({
      config: CONFIG,
      source: SOURCE,
      deadlineMs: 500,
    }),
  ).rejects.toMatchObject({ code: "runtime_error" });

  expect(child.listenerErrors).toEqual([]);
  expect(child.killed).toContain("SIGKILL");
});

it("accepts a legitimate typed worker error without replacing its code", async () => {
  const child = queueChild();
  child.respond.current = (request) => ({
    id: request.id,
    valid: false,
    error: {
      code: "parse_error",
      message: "SQLFluff could not parse the SQL.",
    },
  });
  const runtime = await loadRuntime();

  await expect(
    runtime.formatSqlWithConfig({ config: CONFIG, source: SOURCE }),
  ).rejects.toMatchObject({
    code: "parse_error",
    message: "SQLFluff could not parse the SQL.",
  });

  expect(child.listenerErrors).toEqual([]);
  expect(child.killed).toEqual([]);
});

it("sanitizes an unknown error code and never reflects its message", async () => {
  const marker = "select flagged_source_credential";
  const child = queueChild();
  child.respond.current = (request) => ({
    id: request.id,
    valid: false,
    error: { code: "not_a_known_code", message: marker },
  });
  const runtime = await loadRuntime();

  const failure = runtime.formatSqlWithConfig({
    config: CONFIG,
    source: SOURCE,
    deadlineMs: 500,
  });

  await expect(failure).rejects.toMatchObject({
    code: "runtime_error",
    message: "SQLFluff returned an invalid response.",
  });
  await expect(failure).rejects.not.toThrow(marker);
  expect(child.killed).toContain("SIGKILL");
});

it("ignores a stale id and settles only the exact active request", async () => {
  const child = queueChild();
  child.respond.current = (request) => {
    child.deliver({ id: Number(request.id) - 1, valid: true, error: null });
    return { id: request.id, ...VALIDATE_SUCCESS };
  };
  const runtime = await loadRuntime();

  await expect(runtime.validateSqlFluffConfig(CONFIG)).resolves.toEqual(
    VALIDATE_SUCCESS,
  );

  expect(child.listenerErrors).toEqual([]);
  expect(child.killed).toEqual([]);
});

it("ignores a malformed message from a previous generation", async () => {
  const first = queueChild();
  const second = queueChild();
  first.respond.current = () => null;
  second.respond.current = (request) => {
    first.deliver(null);
    return { id: request.id, ...VALIDATE_SUCCESS };
  };
  const runtime = await loadRuntime();

  await expect(
    runtime.validateSqlFluffConfig(CONFIG, { deadlineMs: 500 }),
  ).resolves.toMatchObject({
    valid: false,
    error: { code: "runtime_error" },
  });
  await expect(runtime.validateSqlFluffConfig(CONFIG)).resolves.toEqual(
    VALIDATE_SUCCESS,
  );

  expect(first.listenerErrors).toEqual([]);
  expect(second.listenerErrors).toEqual([]);
});

it("restarts its own child after a malformed response", async () => {
  const first = queueChild();
  const second = queueChild();
  first.respond.current = (request) => ({
    id: request.id,
    valid: true,
    error: null,
  });
  second.respond.current = (request) => ({
    id: request.id,
    ...VALIDATE_SUCCESS,
  });
  const runtime = await loadRuntime();

  await expect(
    runtime.validateSqlFluffConfig(CONFIG, { deadlineMs: 500 }),
  ).resolves.toMatchObject({
    valid: false,
    error: { code: "runtime_error" },
  });
  expect(first.killed).toContain("SIGKILL");

  await expect(runtime.validateSqlFluffConfig(CONFIG)).resolves.toEqual(
    VALIDATE_SUCCESS,
  );

  expect(control.spawnCount).toBe(2);
  expect(second.requests).toHaveLength(1);
  expect(second.killed).toEqual([]);
});

it("preserves an explicit format changed=false response", async () => {
  const child = queueChild();
  child.respond.current = (request) => ({
    id: request.id,
    valid: true,
    error: null,
    formattedSource: SOURCE,
    changed: false,
    dialect: "bigquery",
    templater: "raw",
  });
  const runtime = await loadRuntime();

  await expect(
    runtime.formatSqlWithConfig({ config: CONFIG, source: SOURCE }),
  ).resolves.toEqual({
    formattedSource: SOURCE,
    changed: false,
    dialect: "bigquery",
    templater: "raw",
  });

  expect(child.listenerErrors).toEqual([]);
});
