import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BOUNDED_TASK_GLOBAL,
  BoundedTaskError,
  createBoundedTaskRunner,
  measureBoundedPayload,
  type BoundedTaskRunner,
  type BoundedTaskRunnerOptions,
  type BoundedTaskSource,
} from "./bounded-tasks.js";

// Each workload reproduces the cost shape of one of the derive
// counterexamples from the Content stored-form review: the serializer's real
// inputs are Content's, but what the bound has to stop is the same.
const TASKS = `
var ${BOUNDED_TASK_GLOBAL} = { tasks: {
  echo(input) { return input; },
  bytes(input) { return { kind: "update", update: new Uint8Array(input.length).fill(7) }; },
  async later(input) { await new Promise((r) => setTimeout(r, input.ms)); return "done"; },
  never() { return new Promise(() => {}); },
  spin() { for (;;) {} },
  throws() { throw new TypeError("bad input"); },
  fn() { return () => 1; },
  // indent feeding repeat(): 1,000 empty paragraphs at indent 100,000.
  indent(input) {
    const lines = [];
    for (let i = 0; i < input.paragraphs; i += 1) lines.push(" ".repeat(input.indent));
    return { kind: "text", text: lines.join("\\n") };
  },
  // Equation latex / table colMeta: 5M tabs escaped with a quadratic rescan.
  tabs(input) {
    let text = "\\t".repeat(input.tabs);
    let out = "";
    for (let i = 0; i < text.length; i += 1) out = out + text.slice(0, i).replace(/\\t/g, "\\\\t").length;
    return { kind: "text", text: out };
  },
  // Repeated mark attributes: one attribute string re-emitted per character.
  marks(input) {
    const attr = "x".repeat(input.attr);
    let out = "";
    for (let i = 0; i < input.chars; i += 1) out += attr;
    return { kind: "text", text: out };
  },
  // Deep nesting serialized by recursion.
  nest(input) {
    let node = { text: "leaf" };
    for (let i = 0; i < input.depth; i += 1) node = { child: node };
    const walk = (n) => (n.child ? "> " + walk(n.child) : n.text);
    return { kind: "text", text: walk(node) };
  },
  // A 200,000-line code block: large but linear.
  code(input) {
    const lines = [];
    for (let i = 0; i < input.lines; i += 1) lines.push("const value" + i + " = " + i + ";");
    return { kind: "text", text: "\`\`\`ts\\n" + lines.join("\\n") + "\\n\`\`\`" };
  },
  // Link scan that restarts at every "[".
  links(input) {
    const text = "[".repeat(input.brackets);
    let found = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== "[") continue;
      for (let j = i + 1; j < text.length; j += 1) if (text[j] === "]") { found += 1; break; }
    }
    return { kind: "text", text: String(found) };
  },
} };
`;

function source(code = TASKS, name = "spec-tasks"): BoundedTaskSource {
  return { kind: "bounded-task-source", name, code };
}

const runners: BoundedTaskRunner[] = [];

function runner(options: Partial<BoundedTaskRunnerOptions> = {}) {
  const created = createBoundedTaskRunner({
    source: source(),
    deadlineMs: 1_000,
    memoryLimitMb: 64,
    ...options,
  });
  runners.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(runners.splice(0).map((created) => created.close()));
  vi.doUnmock("../shared/optional-node-builtins.js");
  vi.resetModules();
});

async function failure(promise: Promise<unknown>): Promise<BoundedTaskError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BoundedTaskError);
    return error as BoundedTaskError;
  }
  throw new Error("expected the task to fail");
}

/** Runs `work` while measuring the longest gap between 10 ms timer ticks. */
async function withHeartbeat<T>(
  work: () => Promise<T>,
): Promise<{ result: T; maxGapMs: number; elapsedMs: number }> {
  const start = performance.now();
  let last = start;
  let maxGapMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGapMs = Math.max(maxGapMs, now - last);
    last = now;
  }, 10);
  try {
    const result = await work();
    return { result, maxGapMs, elapsedMs: performance.now() - start };
  } finally {
    clearInterval(timer);
  }
}

describe("createBoundedTaskRunner", () => {
  it("runs a task in a worker and returns plain data", async () => {
    const tasks = runner();
    await expect(tasks.run("echo", { a: [1, "two", null] })).resolves.toEqual({
      a: [1, "two", null],
    });
    const output = await tasks.run<{ update: Uint8Array }>("bytes", {
      length: 4,
    });
    expect(output.update).toEqual(new Uint8Array([7, 7, 7, 7]));
  });

  it("stops a task that never returns at the deadline without blocking this thread", async () => {
    const tasks = runner({ deadlineMs: 400 });
    const { result, maxGapMs, elapsedMs } = await withHeartbeat(() =>
      failure(tasks.run("spin", {})),
    );
    expect(result.code).toBe("deadline_exceeded");
    expect(elapsedMs).toBeLessThan(400 + 5_000);
    expect(maxGapMs).toBeLessThan(250);
    await expect(tasks.run("echo", "after")).resolves.toBe("after");
  });

  it("stops a task whose promise never settles", async () => {
    const tasks = runner({ deadlineMs: 200 });
    expect((await failure(tasks.run("never", {}))).code).toBe(
      "deadline_exceeded",
    );
  });

  it("refuses indent feeding repeat() (about 100 MB of output)", async () => {
    const tasks = runner();
    const { result, maxGapMs } = await withHeartbeat(() =>
      failure(tasks.run("indent", { paragraphs: 1_000, indent: 100_000 })),
    );
    expect(["memory_exceeded", "output_too_large"]).toContain(result.code);
    expect(maxGapMs).toBeLessThan(250);
  });

  it("stops the 5M-tab latex/colMeta rescan at the deadline", async () => {
    const tasks = runner({ deadlineMs: 500 });
    const { result, maxGapMs } = await withHeartbeat(() =>
      failure(tasks.run("tabs", { tabs: 5_000_000 })),
    );
    expect(["deadline_exceeded", "memory_exceeded"]).toContain(result.code);
    expect(maxGapMs).toBeLessThan(250);
  });

  it("refuses 5M tabs passed in directly before any worker runs", async () => {
    const tasks = runner();
    const result = await failure(tasks.run("echo", "\t".repeat(5_000_000)));
    expect(result.code).toBe("input_too_large");
    expect(tasks.stats().workers).toBe(0);
  });

  it("refuses repeated mark attributes (50M characters)", async () => {
    const tasks = runner();
    const { result, maxGapMs } = await withHeartbeat(() =>
      failure(tasks.run("marks", { attr: 1_000, chars: 50_000 })),
    );
    expect([
      "memory_exceeded",
      "output_too_large",
      "deadline_exceeded",
    ]).toContain(result.code);
    expect(maxGapMs).toBeLessThan(250);
  });

  it("reports deep nesting as a typed failure instead of crashing", async () => {
    const tasks = runner();
    const result = await failure(tasks.run("nest", { depth: 1_000_000 }));
    expect(result.code).toBe("task_threw");
    expect(result.taskErrorName).toBe("RangeError");
    await expect(tasks.run("echo", 1)).resolves.toBe(1);
  });

  it("completes a 200,000-line code block inside the bound", async () => {
    const tasks = runner({ deadlineMs: 2_000 });
    const { result, maxGapMs } = await withHeartbeat(() =>
      tasks.run<{ text: string }>("code", { lines: 200_000 }),
    );
    expect(result.text.split("\n")).toHaveLength(200_002);
    expect(maxGapMs).toBeLessThan(250);
  });

  it("stops the quadratic link scan on many [ at the deadline", async () => {
    const tasks = runner({ deadlineMs: 400 });
    const { result, maxGapMs } = await withHeartbeat(() =>
      failure(tasks.run("links", { brackets: 1_000_000 })),
    );
    expect(result.code).toBe("deadline_exceeded");
    expect(maxGapMs).toBeLessThan(250);
  });

  it("runs at most maxWorkers tasks and refuses work beyond the queue", async () => {
    const tasks = runner({
      maxWorkers: 2,
      maxQueue: 1,
      deadlineMs: 300,
      queueTimeoutMs: 5_000,
    });
    const running = [1, 2, 3].map(() => failure(tasks.run("spin", {})));
    const refused = await failure(tasks.run("echo", "late"));
    expect(refused.code).toBe("queue_full");
    expect(tasks.stats().workers).toBeLessThanOrEqual(2);
    expect(tasks.stats().running + tasks.stats().queued).toBe(3);
    const codes = (await Promise.all(running)).map((error) => error.code);
    expect(codes).toEqual([
      "deadline_exceeded",
      "deadline_exceeded",
      "deadline_exceeded",
    ]);
  });

  it("refuses worker and queue limits that are not whole counts", () => {
    for (const limits of [
      { maxWorkers: 1.5 },
      { maxWorkers: 0 },
      { maxQueue: 0.5 },
      { maxQueue: -1 },
    ]) {
      expect(() =>
        createBoundedTaskRunner({ source: source(), ...limits }),
      ).toThrow(RangeError);
    }
  });

  it("fails a task that waits longer than queueTimeoutMs", async () => {
    const tasks = runner({
      maxWorkers: 1,
      maxQueue: 4,
      deadlineMs: 2_000,
      queueTimeoutMs: 150,
    });
    const blocker = tasks.run("later", { ms: 1_000 });
    const waited = await failure(tasks.run("echo", "queued"));
    expect(waited.code).toBe("queue_timeout");
    await expect(blocker).resolves.toBe("done");
  });

  it("does not count worker startup against queueTimeoutMs", async () => {
    const slowStart = createBoundedTaskRunner({
      source: source(
        `var started = Date.now(); while (Date.now() - started < 400) {}\n${TASKS}`,
        "slow-start",
      ),
      queueTimeoutMs: 50,
      memoryLimitMb: 64,
    });
    runners.push(slowStart);
    await expect(
      Promise.all([slowStart.run("echo", 1), slowStart.run("echo", 2)]),
    ).resolves.toEqual([1, 2]);
  });

  it("keeps a killed worker under maxWorkers until it has exited", async () => {
    const real = await import("node:worker_threads");
    let alive = 0;
    let peak = 0;
    class CountingWorker extends real.Worker {
      constructor(...args: ConstructorParameters<typeof real.Worker>) {
        super(...args);
        alive += 1;
        peak = Math.max(peak, alive);
        this.once("exit", () => {
          alive -= 1;
        });
      }
    }
    vi.resetModules();
    vi.doMock("../shared/optional-node-builtins.js", () => ({
      getWorkerThreads: () => ({ ...real, Worker: CountingWorker }),
    }));
    const isolated = await import("./bounded-tasks.js");
    const tasks = isolated.createBoundedTaskRunner({
      source: source(),
      maxWorkers: 1,
      deadlineMs: 150,
      queueTimeoutMs: 10_000,
      memoryLimitMb: 64,
    });
    runners.push(tasks);
    const codes = await Promise.all(
      ["spin", "spin", "echo"].map((task) =>
        tasks.run(task, 1).then(
          () => "ok",
          (error: { code: string }) => error.code,
        ),
      ),
    );
    expect(codes).toEqual(["deadline_exceeded", "deadline_exceeded", "ok"]);
    expect(peak).toBe(1);

    const killed = tasks.run("spin", 1).catch(() => undefined);
    await vi.waitFor(() => expect(tasks.stats().running).toBe(1), {
      timeout: 5_000,
    });
    await killed;
    await tasks.close();
    expect(alive).toBe(0);
  });

  it("bounds a task waiting on a worker that is still terminating", async () => {
    const real = await import("node:worker_threads");
    let release!: () => void;
    const exitHeld = new Promise<void>((resolve) => {
      release = resolve;
    });
    class SlowExitWorker extends real.Worker {
      override async terminate(): Promise<number> {
        await exitHeld;
        return super.terminate();
      }
    }
    vi.resetModules();
    vi.doMock("../shared/optional-node-builtins.js", () => ({
      getWorkerThreads: () => ({ ...real, Worker: SlowExitWorker }),
    }));
    const isolated = await import("./bounded-tasks.js");
    const tasks = isolated.createBoundedTaskRunner({
      source: source(),
      maxWorkers: 1,
      deadlineMs: 150,
      queueTimeoutMs: 100,
      memoryLimitMb: 64,
    });
    runners.push(tasks);
    const code = (task: string) =>
      tasks.run(task, 1).then(
        () => "ok",
        (error: InstanceType<typeof isolated.BoundedTaskError>) => error.code,
      );
    try {
      expect(await code("spin")).toBe("deadline_exceeded");
      expect(tasks.stats()).toMatchObject({ workers: 1, running: 0 });
      expect(await code("echo")).toBe("queue_timeout");
    } finally {
      release();
    }
  });

  it("measures a typed-array view by the whole buffer it copies", async () => {
    const view = new Uint8Array(new ArrayBuffer(64 * 1024), 0, 1);
    expect(measureBoundedPayload(view, Infinity)).toBe(64 * 1024);
    expect(
      measureBoundedPayload(new Uint8Array(new SharedArrayBuffer(8)), Infinity),
    ).toBe(-1);
    const tasks = runner({ maxInputBytes: 4_096 });
    expect((await failure(tasks.run("echo", view))).code).toBe(
      "input_too_large",
    );
    expect(
      (
        await failure(
          tasks.run("echo", new Uint8Array(new SharedArrayBuffer(8))),
        )
      ).code,
    ).toBe("invalid_input");
  });

  it("checks a queued input again before sending it", async () => {
    const tasks = runner({
      maxWorkers: 1,
      maxInputBytes: 4_096,
      queueTimeoutMs: 5_000,
    });
    await tasks.run("echo", "warm");
    const blocker = tasks.run("later", { ms: 150 });
    const input = { text: "tiny" };
    const queued = failure(tasks.run("echo", input));
    input.text = "x".repeat(20_000);
    expect((await queued).code).toBe("input_too_large");
    await expect(blocker).resolves.toBe("done");
  });

  it("stops a worker that comes up after the task it was started for gave up", async () => {
    const slowStart = createBoundedTaskRunner({
      source: source(
        `var started = Date.now(); while (Date.now() - started < 300) {}
${TASKS}`,
        "slow-start",
      ),
      maxWorkers: 2,
      deadlineMs: 10_000,
      queueTimeoutMs: 50,
      idleTimeoutMs: 100,
      memoryLimitMb: 64,
    });
    runners.push(slowStart);
    const busy = slowStart.run("later", { ms: 4_000 }).catch(() => undefined);
    await vi.waitFor(() => expect(slowStart.stats().running).toBe(1), {
      timeout: 5_000,
    });
    expect((await failure(slowStart.run("echo", 1))).code).toBe(
      "queue_timeout",
    );
    expect(slowStart.stats().workers).toBe(2);
    await vi.waitFor(() => expect(slowStart.stats().workers).toBe(1), {
      timeout: 3_000,
    });
    expect(slowStart.stats().running).toBe(1);
    await slowStart.close();
    await busy;
  });

  it("maps task errors, unknown tasks and non-plain output to typed codes", async () => {
    const tasks = runner();
    const threw = await failure(tasks.run("throws", {}));
    expect(threw.code).toBe("task_threw");
    expect(threw.taskErrorName).toBe("TypeError");
    expect((await failure(tasks.run("missing", {}))).code).toBe("task_unknown");
    expect((await failure(tasks.run("fn", {}))).code).toBe("invalid_output");
    expect((await failure(tasks.run("echo", { f: () => 1 }))).code).toBe(
      "invalid_input",
    );
  });

  it("measures output against maxOutputBytes inside the worker", async () => {
    const tasks = runner({ maxOutputBytes: 1_000 });
    expect((await failure(tasks.run("echo", "x".repeat(501)))).code).toBe(
      "output_too_large",
    );
    await expect(tasks.run("echo", "x".repeat(500))).resolves.toHaveLength(500);
  });

  it("fails every waiting task when the module cannot start", async () => {
    const broken = createBoundedTaskRunner({
      source: source("var nothing = 1;", "broken"),
      maxQueue: 2,
    });
    runners.push(broken);
    const results = await Promise.all([
      failure(broken.run("echo", 1)),
      failure(broken.run("echo", 2)),
    ]);
    expect(results.map((error) => error.code)).toEqual([
      "startup_failed",
      "startup_failed",
    ]);
  });

  it("fails waiting tasks once, not by respawning, when the module outgrows its heap", async () => {
    const real = await import("node:worker_threads");
    let started = 0;
    class CountingWorker extends real.Worker {
      constructor(...args: ConstructorParameters<typeof real.Worker>) {
        super(...args);
        started += 1;
      }
    }
    vi.resetModules();
    vi.doMock("../shared/optional-node-builtins.js", () => ({
      getWorkerThreads: () => ({ ...real, Worker: CountingWorker }),
    }));
    const isolated = await import("./bounded-tasks.js");
    const tasks = isolated.createBoundedTaskRunner({
      source: source(
        "var held = []; for (;;) held.push(new Array(10000).fill(Math.random()));",
        "greedy",
      ),
      memoryLimitMb: 16,
      startupTimeoutMs: 20_000,
      queueTimeoutMs: 100,
    });
    runners.push(tasks);
    const code = await tasks.run("echo", 1).then(
      () => "ok",
      (error: InstanceType<typeof isolated.BoundedTaskError>) => error.code,
    );
    expect(code).toBe("startup_failed");
    expect(started).toBe(1);
  });

  it("fails with unavailable, never inline, where worker threads do not exist", async () => {
    vi.resetModules();
    vi.doMock("../shared/optional-node-builtins.js", () => ({
      getWorkerThreads: () => undefined,
    }));
    const isolated = await import("./bounded-tasks.js");
    const tasks = isolated.createBoundedTaskRunner({ source: source() });
    runners.push(tasks);
    const result = await tasks.run("echo", 1).then(
      () => null,
      (error: InstanceType<typeof isolated.BoundedTaskError>) => error,
    );
    expect(result?.code).toBe("unavailable");
  });

  it("fails running and later tasks once closed", async () => {
    const tasks = runner({ deadlineMs: 5_000 });
    const running = failure(tasks.run("spin", {}));
    await vi.waitFor(() => expect(tasks.stats().running).toBe(1), {
      timeout: 5_000,
    });
    await tasks.close();
    expect((await running).code).toBe("closed");
    expect((await failure(tasks.run("echo", 1))).code).toBe("closed");
    expect(tasks.stats().workers).toBe(0);
  });
});
