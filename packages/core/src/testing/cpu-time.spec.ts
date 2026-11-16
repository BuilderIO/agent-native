import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { measureCpuMs } from "./cpu-time.js";

/** Runs `run` on a runtime without process.threadCpuUsage (Node < 22.19). */
async function withoutThreadCpuUsage(run: () => unknown): Promise<void> {
  const threadCpuUsage = Object.getOwnPropertyDescriptor(
    process,
    "threadCpuUsage",
  );
  Reflect.deleteProperty(process, "threadCpuUsage");
  try {
    await run();
  } finally {
    if (threadCpuUsage) {
      Object.defineProperty(process, "threadCpuUsage", threadCpuUsage);
    }
  }
}

describe("measureCpuMs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("node:worker_threads");
    vi.resetModules();
  });

  // The whole point of the helper: time the thread spends waiting, the way a
  // test does while a loaded runner schedules other work, costs no CPU.
  it("does not charge time spent waiting", async () => {
    expect(await measureCpuMs(() => sleep(300))).toBeLessThan(150);
  });

  it.each([undefined, null, 42])(
    "adds user and system time of this thread for a sync run returning %s",
    (value) => {
      vi.spyOn(process, "threadCpuUsage")
        .mockReturnValueOnce({ user: 1_000, system: 500 })
        .mockReturnValueOnce({ user: 4_000, system: 2_500 });

      expect(measureCpuMs(() => value)).toBe(5);
    },
  );

  it("reads the clock again only after an async run settles", async () => {
    let usage = { user: 0, system: 0 };
    vi.spyOn(process, "threadCpuUsage").mockImplementation(() => usage);

    const measured = measureCpuMs(async () => {
      await Promise.resolve();
      usage = { user: 7_000, system: 1_000 };
    });

    expect(await measured).toBe(8);
  });

  // CI's Node 22 lanes may predate threadCpuUsage (22.19); the forks pool runs
  // each test file on its own process's main thread, where cpuUsage is exact.
  it("falls back to process.cpuUsage() on a runtime without threadCpuUsage", async () => {
    await withoutThreadCpuUsage(async () => {
      const cpuUsage = vi.spyOn(process, "cpuUsage");

      expect(await measureCpuMs(() => sleep(300))).toBeLessThan(150);
      expect(cpuUsage).toHaveBeenCalledTimes(2);
    });
  });

  it("refuses the process-wide clock inside a worker thread", async () => {
    // The static import above already evaluated cpu-time.js with the real
    // isMainThread; without a reset the dynamic import returns that module.
    vi.resetModules();
    vi.doMock("node:worker_threads", () => ({ isMainThread: false }));
    const { measureCpuMs: measureInWorker } = await import("./cpu-time.js");

    await withoutThreadCpuUsage(() => {
      expect(() => measureInWorker(() => undefined)).toThrow(
        /process\.threadCpuUsage\(\).*worker thread/,
      );
    });
  });
});
