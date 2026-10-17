import type { Worker as NodeWorker } from "node:worker_threads";

import { getWorkerThreads } from "../shared/optional-node-builtins.js";
import {
  BOUNDED_TASK_GLOBAL,
  type BoundedTaskSource,
} from "./bounded-task-source.js";

export { BOUNDED_TASK_GLOBAL, type BoundedTaskSource };

export type BoundedTaskErrorCode =
  | "unavailable"
  | "closed"
  | "queue_full"
  | "queue_timeout"
  | "invalid_input"
  | "input_too_large"
  | "startup_failed"
  | "task_unknown"
  | "task_threw"
  | "deadline_exceeded"
  | "memory_exceeded"
  | "invalid_output"
  | "output_too_large"
  | "worker_crashed";

export class BoundedTaskError extends Error {
  readonly code: BoundedTaskErrorCode;
  readonly task: string;
  /** `name` of the error the task threw, for `task_threw`. */
  readonly taskErrorName?: string;

  constructor(
    code: BoundedTaskErrorCode,
    task: string,
    message: string,
    options: { cause?: unknown; taskErrorName?: string } = {},
  ) {
    super(message, options.cause === undefined ? undefined : options);
    this.name = "BoundedTaskError";
    this.code = code;
    this.task = task;
    if (options.taskErrorName) this.taskErrorName = options.taskErrorName;
  }
}

export interface BoundedTaskRunnerOptions {
  source: BoundedTaskSource;
  /** Wall-clock budget for one task once a worker has it. Default 2000 ms. */
  deadlineMs?: number;
  /** Budget for a fresh worker to evaluate the bundle. Default 10000 ms. */
  startupTimeoutMs?: number;
  /** Workers alive at once; also the number of tasks running at once. Default 1. */
  maxWorkers?: number;
  /** Tasks allowed to wait for a worker. Beyond this, `queue_full`. Default 8. */
  maxQueue?: number;
  /**
   * Longest a task may wait for a busy or terminating worker. A task waiting
   * only for a worker to start is bounded by `startupTimeoutMs` instead.
   * Default `deadlineMs`.
   */
  queueTimeoutMs?: number;
  /** Strings count two bytes per UTF-16 unit. Default 8 MiB. */
  maxInputBytes?: number;
  /** Checked inside the worker before the result is copied out. Default 16 MiB. */
  maxOutputBytes?: number;
  /** Worker old-generation heap. Default 128 MiB. */
  memoryLimitMb?: number;
  /** Default 4 MiB. */
  stackSizeMb?: number;
  /** An idle worker is stopped after this long. Default 30000 ms. */
  idleTimeoutMs?: number;
}

export interface BoundedTaskRunnerStats {
  workers: number;
  running: number;
  queued: number;
}

export interface BoundedTaskRunner {
  readonly name: string;
  run<Output = unknown>(task: string, input: unknown): Promise<Output>;
  stats(): BoundedTaskRunnerStats;
  close(): Promise<void>;
}

/**
 * Size of a structured-clone payload in bytes, or -1 when it holds anything
 * but plain data (or more than 200,000 values). Stops counting once
 * `limit` is passed. The worker host evaluates this function's source, so it
 * must not reference anything outside its own body.
 */
export function measureBoundedPayload(value: unknown, limit: number): number {
  const maxNodes = 200_000;
  let total = 0;
  let nodes = 0;
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > maxNodes) return -1;
    if (
      current === null ||
      current === undefined ||
      typeof current === "boolean"
    ) {
      total += 1;
    } else if (typeof current === "number") {
      total += 8;
    } else if (typeof current === "string") {
      total += current.length * 2;
    } else if (typeof current === "object") {
      if (seen.has(current)) return -1;
      seen.add(current);
      if (ArrayBuffer.isView(current)) {
        // Structured clone copies a view's whole buffer, and a shared buffer
        // is not copied at all, so the task would see later writes.
        if (
          typeof SharedArrayBuffer !== "undefined" &&
          current.buffer instanceof SharedArrayBuffer
        ) {
          return -1;
        }
        total += current.buffer.byteLength;
      } else if (Array.isArray(current)) {
        total += 8;
        for (let index = 0; index < current.length; index += 1) {
          stack.push(current[index]);
        }
      } else {
        const proto = Object.getPrototypeOf(current);
        if (proto !== Object.prototype && proto !== null) return -1;
        for (const key of Object.keys(current)) {
          total += key.length * 2;
          stack.push((current as Record<string, unknown>)[key]);
        }
      }
    } else {
      return -1;
    }
    if (total > limit) return total;
  }
  return total;
}

function hostScript(source: BoundedTaskSource): string {
  return `"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const measureBoundedPayload = ${measureBoundedPayload.toString()};
${source.code}
;(() => {
  const loaded = typeof ${BOUNDED_TASK_GLOBAL} === "undefined" ? undefined : ${BOUNDED_TASK_GLOBAL};
  const tasks = loaded && typeof loaded === "object"
    ? (loaded.tasks || (loaded.default && loaded.default.tasks))
    : undefined;
  if (!tasks || typeof tasks !== "object") {
    throw new Error("Bounded task module ${JSON.stringify(source.name).slice(1, -1)} does not export a tasks object");
  }
  const describe = (error) => ({
    name: error && typeof error.name === "string" ? error.name : "Error",
    message: String(error && error.message !== undefined ? error.message : error).slice(0, 2000),
  });
  parentPort.on("message", async (message) => {
    const id = message.id;
    const run = Object.prototype.hasOwnProperty.call(tasks, message.task) ? tasks[message.task] : undefined;
    if (typeof run !== "function") {
      parentPort.postMessage({ id, ok: false, code: "task_unknown", name: "Error", message: "Unknown task " + String(message.task) });
      return;
    }
    let output;
    try {
      output = await run(message.input);
    } catch (error) {
      parentPort.postMessage({ id, ok: false, code: "task_threw", ...describe(error) });
      return;
    }
    const size = measureBoundedPayload(output, workerData.maxOutputBytes);
    if (size < 0) {
      parentPort.postMessage({ id, ok: false, code: "invalid_output", name: "Error", message: "Task output is not plain data" });
      return;
    }
    if (size > workerData.maxOutputBytes) {
      parentPort.postMessage({ id, ok: false, code: "output_too_large", name: "Error", message: "Task output exceeds " + workerData.maxOutputBytes + " bytes" });
      return;
    }
    try {
      parentPort.postMessage({ id, ok: true, output });
    } catch (error) {
      parentPort.postMessage({ id, ok: false, code: "invalid_output", ...describe(error) });
    }
  });
  parentPort.postMessage({ ready: true });
})();
`;
}

type Settle = {
  resolve: (value: unknown) => void;
  reject: (error: BoundedTaskError) => void;
};

interface PendingTask extends Settle {
  task: string;
  input: unknown;
  queueTimer?: ReturnType<typeof setTimeout>;
}

interface Slot {
  worker: NodeWorker;
  ready: boolean;
  current?: PendingTask & {
    id: number;
    deadline: ReturnType<typeof setTimeout>;
  };
  startupTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  dead: boolean;
}

/**
 * Runs functions from one bundled module in worker threads, each under a
 * terminable deadline and a heap limit, with a fixed number of workers and a
 * bounded wait queue. A task that overruns is stopped by terminating its
 * worker, so synchronous work in the task never blocks the caller's event
 * loop. Where worker threads do not exist (Cloudflare Workers), every run
 * fails with `unavailable`; it never falls back to running inline.
 */
export function createBoundedTaskRunner(
  options: BoundedTaskRunnerOptions,
): BoundedTaskRunner {
  const { source } = options;
  if (
    !source ||
    source.kind !== "bounded-task-source" ||
    typeof source.code !== "string" ||
    typeof source.name !== "string"
  ) {
    throw new TypeError(
      "createBoundedTaskRunner needs a BoundedTaskSource from bundleBoundedTaskSource",
    );
  }
  const deadlineMs = positive(options.deadlineMs, 2_000, "deadlineMs");
  const startupTimeoutMs = positive(
    options.startupTimeoutMs,
    10_000,
    "startupTimeoutMs",
  );
  const maxWorkers = count(options.maxWorkers, 1, 1, "maxWorkers");
  const maxQueue = count(options.maxQueue, 8, 0, "maxQueue");
  const queueTimeoutMs = positive(
    options.queueTimeoutMs,
    deadlineMs,
    "queueTimeoutMs",
  );
  const maxInputBytes = positive(
    options.maxInputBytes,
    8 * 1024 * 1024,
    "maxInputBytes",
  );
  const maxOutputBytes = positive(
    options.maxOutputBytes,
    16 * 1024 * 1024,
    "maxOutputBytes",
  );
  const memoryLimitMb = positive(options.memoryLimitMb, 128, "memoryLimitMb");
  const stackSizeMb = positive(options.stackSizeMb, 4, "stackSizeMb");
  const idleTimeoutMs = positive(
    options.idleTimeoutMs,
    30_000,
    "idleTimeoutMs",
  );
  const script = hostScript(source);

  const slots: Slot[] = [];
  // A terminated worker can keep running for a while; it holds its place
  // under maxWorkers until it has exited.
  const terminating = new Set<Promise<void>>();
  const queue: PendingTask[] = [];
  let nextId = 1;
  let closed = false;

  const fail = (
    pending: Settle,
    code: BoundedTaskErrorCode,
    task: string,
    message: string,
    extra: { cause?: unknown; taskErrorName?: string } = {},
  ) => pending.reject(new BoundedTaskError(code, task, message, extra));

  function removeSlot(slot: Slot): void {
    if (slot.dead) return;
    slot.dead = true;
    if (slot.startupTimer) clearTimeout(slot.startupTimer);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    const index = slots.indexOf(slot);
    if (index >= 0) slots.splice(index, 1);
    const exited: Promise<void> = slot.worker
      .terminate()
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        terminating.delete(exited);
        if (!closed) drain();
      });
    terminating.add(exited);
  }

  function killSlot(
    slot: Slot,
    code: BoundedTaskErrorCode,
    message: string,
    cause?: unknown,
  ): void {
    if (slot.dead) return;
    const current = slot.current;
    slot.current = undefined;
    if (current) {
      clearTimeout(current.deadline);
      fail(current, code, current.task, message, { cause });
    }
    removeSlot(slot);
    if (code === "startup_failed") {
      // Respawning would hit the same broken bundle; fail what is waiting.
      for (const task of queue.splice(0, queue.length)) {
        if (task.queueTimer) clearTimeout(task.queueTimer);
        fail(task, code, task.task, message, { cause });
      }
      return;
    }
    drain();
  }

  function spawn(): Slot | null {
    const threads = getWorkerThreads();
    let worker: NodeWorker;
    try {
      if (!threads?.Worker) throw new Error("node:worker_threads is missing");
      worker = new threads.Worker(script, {
        eval: true,
        workerData: { maxOutputBytes },
        resourceLimits: {
          maxOldGenerationSizeMb: memoryLimitMb,
          stackSizeMb,
        },
      });
    } catch (error) {
      unavailable(error);
      return null;
    }
    worker.unref();
    const slot: Slot = { worker, ready: false, dead: false };
    slot.startupTimer = setTimeout(() => {
      killSlot(
        slot,
        "startup_failed",
        `Bounded task module ${source.name} did not start within ${startupTimeoutMs} ms`,
      );
    }, startupTimeoutMs);
    slot.startupTimer.unref?.();

    worker.on("message", (message: any) => {
      if (slot.dead) return;
      if (message?.ready === true) {
        slot.ready = true;
        if (slot.startupTimer) clearTimeout(slot.startupTimer);
        slot.startupTimer = undefined;
        drain();
        armQueueTimers();
        if (!slot.current) markIdle(slot);
        return;
      }
      const current = slot.current;
      if (!current || message?.id !== current.id) return;
      clearTimeout(current.deadline);
      slot.current = undefined;
      if (message.ok === true) {
        current.resolve(message.output);
      } else {
        const code: BoundedTaskErrorCode =
          message.code === "task_unknown" ||
          message.code === "invalid_output" ||
          message.code === "output_too_large"
            ? message.code
            : "task_threw";
        fail(
          current,
          code,
          current.task,
          `Bounded task ${source.name}.${current.task} failed: ${String(message.message)}`,
          { taskErrorName: String(message.name ?? "Error") },
        );
      }
      markIdle(slot);
      drain();
    });
    worker.on("error", (error: Error & { code?: string }) => {
      const outOfMemory = error?.code === "ERR_WORKER_OUT_OF_MEMORY";
      // Before ready no task is running, so running out of heap means the
      // module itself does; a respawn would too, forever.
      if (!slot.ready) {
        killSlot(
          slot,
          "startup_failed",
          outOfMemory
            ? `Bounded task module ${source.name} exceeded its ${memoryLimitMb} MiB heap while starting`
            : `Bounded task module ${source.name} failed to start: ${error?.message}`,
          error,
        );
        return;
      }
      killSlot(
        slot,
        outOfMemory ? "memory_exceeded" : "worker_crashed",
        outOfMemory
          ? `Bounded task ${source.name} exceeded its ${memoryLimitMb} MiB heap`
          : `Bounded task worker for ${source.name} crashed: ${error?.message}`,
        error,
      );
    });
    worker.on("exit", (exitCode: number) => {
      killSlot(
        slot,
        slot.ready ? "worker_crashed" : "startup_failed",
        `Bounded task worker for ${source.name} exited with code ${exitCode}`,
      );
    });
    slots.push(slot);
    return slot;
  }

  function unavailable(error: unknown): void {
    const pending = queue.splice(0, queue.length);
    for (const task of pending) {
      if (task.queueTimer) clearTimeout(task.queueTimer);
      fail(
        task,
        "unavailable",
        task.task,
        `Worker threads are unavailable here, so bounded task ${source.name}.${task.task} cannot run`,
        { cause: error },
      );
    }
  }

  function armQueueTimers(): void {
    for (const pending of queue) {
      if (pending.queueTimer) continue;
      pending.queueTimer = setTimeout(() => {
        const index = queue.indexOf(pending);
        if (index < 0) return;
        queue.splice(index, 1);
        fail(
          pending,
          "queue_timeout",
          pending.task,
          `Bounded task ${source.name}.${pending.task} waited more than ${queueTimeoutMs} ms for a worker`,
        );
      }, queueTimeoutMs);
      pending.queueTimer.unref?.();
    }
  }

  function markIdle(slot: Slot): void {
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = setTimeout(() => {
      if (!slot.current) removeSlot(slot);
    }, idleTimeoutMs);
    slot.idleTimer.unref?.();
  }

  function dispatch(slot: Slot, task: PendingTask): void {
    if (task.queueTimer) clearTimeout(task.queueTimer);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    const id = nextId++;
    const deadline = setTimeout(() => {
      killSlot(
        slot,
        "deadline_exceeded",
        `Bounded task ${source.name}.${task.task} did not finish within ${deadlineMs} ms`,
      );
    }, deadlineMs);
    deadline.unref?.();
    slot.current = { ...task, id, deadline };
    try {
      slot.worker.postMessage({ id, task: task.task, input: task.input });
    } catch (error) {
      clearTimeout(deadline);
      slot.current = undefined;
      fail(
        task,
        "invalid_input",
        task.task,
        `Bounded task ${source.name}.${task.task} input cannot be sent to a worker`,
        { cause: error },
      );
      markIdle(slot);
    }
  }

  function admit(pending: PendingTask): boolean {
    const size = measureBoundedPayload(pending.input, maxInputBytes);
    if (size < 0) {
      fail(
        pending,
        "invalid_input",
        pending.task,
        `Bounded task ${source.name}.${pending.task} input is not plain data`,
      );
      return false;
    }
    if (size > maxInputBytes) {
      fail(
        pending,
        "input_too_large",
        pending.task,
        `Bounded task ${source.name}.${pending.task} input exceeds ${maxInputBytes} bytes`,
      );
      return false;
    }
    return true;
  }

  function drain(): void {
    while (queue.length > 0) {
      const idle = slots.find((slot) => slot.ready && !slot.current);
      if (!idle) break;
      const next = queue.shift()!;
      if (next.queueTimer) clearTimeout(next.queueTimer);
      // The caller still holds the input and can grow it while it waits;
      // postMessage copies it in this same turn, so this check holds.
      if (!admit(next)) continue;
      dispatch(idle, next);
    }
    let needed = queue.length - slots.filter((slot) => !slot.ready).length;
    while (needed > 0 && slots.length + terminating.size < maxWorkers) {
      if (!spawn()) return;
      needed -= 1;
    }
  }

  return {
    name: source.name,
    run<Output>(task: string, input: unknown): Promise<Output> {
      return new Promise<Output>((resolve, reject) => {
        const pending: PendingTask = {
          task,
          input,
          resolve: resolve as (value: unknown) => void,
          reject,
        };
        if (closed) {
          fail(
            pending,
            "closed",
            task,
            `Bounded task runner ${source.name} is closed`,
          );
          return;
        }
        if (!admit(pending)) return;
        const running = slots.filter((slot) => slot.current).length;
        if (running + queue.length >= maxWorkers + maxQueue) {
          fail(
            pending,
            "queue_full",
            task,
            `Bounded task runner ${source.name} already has ${maxQueue} tasks waiting`,
          );
          return;
        }
        queue.push(pending);
        drain();
        // Only a starting worker bounds the wait by itself. With no slot at
        // all, the task waits on a worker still terminating, which has none.
        if (slots.length === 0 || slots.some((slot) => slot.ready)) {
          armQueueTimers();
        }
      });
    },
    stats() {
      return {
        workers: slots.length + terminating.size,
        running: slots.filter((slot) => slot.current).length,
        queued: queue.length,
      };
    },
    async close() {
      closed = true;
      for (const task of queue.splice(0, queue.length)) {
        if (task.queueTimer) clearTimeout(task.queueTimer);
        fail(
          task,
          "closed",
          task.task,
          `Bounded task runner ${source.name} closed`,
        );
      }
      for (const slot of slots.slice()) {
        killSlot(slot, "closed", `Bounded task runner ${source.name} closed`);
      }
      await Promise.all(terminating);
    },
  };
}

function positive(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `Bounded task option ${name} must be a positive number`,
    );
  }
  return value;
}

function count(
  value: number | undefined,
  fallback: number,
  min: 0 | 1,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(
      `Bounded task option ${name} must be an integer of at least ${min}`,
    );
  }
  return value;
}
