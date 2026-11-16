import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { measureCpuMs } from "./cpu-time.js";

function spin(iterations: number): number {
  let total = 0;
  for (let index = 0; index < iterations; index += 1) {
    total = (total + index * 31) % 1_000_003;
  }
  return total;
}

describe("measureCpuMs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The whole point of the helper: time the thread spends waiting, the way a
  // test does while a loaded runner schedules other work, costs no CPU.
  it("does not charge time spent waiting", async () => {
    expect(await measureCpuMs(() => sleep(300))).toBeLessThan(150);
  });

  it("charges work done on this thread", () => {
    expect(measureCpuMs(() => spin(5_000_000))).toBeGreaterThan(0);
  });

  // CI's Node 22 lanes may predate threadCpuUsage (22.19); the forks pool runs
  // each test file on its own process's main thread, where cpuUsage is exact.
  it("falls back to process.cpuUsage() on a runtime without threadCpuUsage", async () => {
    const threadCpuUsage = Object.getOwnPropertyDescriptor(
      process,
      "threadCpuUsage",
    );
    Reflect.deleteProperty(process, "threadCpuUsage");
    try {
      const cpuUsage = vi.spyOn(process, "cpuUsage");

      expect(await measureCpuMs(() => sleep(300))).toBeLessThan(150);
      expect(cpuUsage).toHaveBeenCalledTimes(2);
    } finally {
      if (threadCpuUsage) {
        Object.defineProperty(process, "threadCpuUsage", threadCpuUsage);
      }
    }
  });
});
