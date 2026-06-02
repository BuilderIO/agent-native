import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The cleanup job's job is to bound trace storage by purging rows older
// than a retention horizon. The high-value behavior to lock down is the
// retention-cutoff math and the "disabled" escape hatch
// (AGENT_NATIVE_TRACE_RETENTION_DAYS=0), plus the idempotency of the
// recurring scheduler. We mock the store so no real DB is touched and so
// we can read back exactly which cutoff timestamp was passed to the
// delete.

const deleteOldTraceData = vi.hoisted(() => vi.fn());

vi.mock("./store.js", () => ({
  deleteOldTraceData: (...args: unknown[]) => deleteOldTraceData(...args),
}));

const { runTraceCleanupOnce, startTraceCleanupJob, stopTraceCleanupJob } =
  await import("./cleanup-job.js");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ENV_KEY = "AGENT_NATIVE_TRACE_RETENTION_DAYS";

describe("trace cleanup retention logic", () => {
  const originalEnv = process.env[ENV_KEY];

  beforeEach(() => {
    vi.clearAllMocks();
    deleteOldTraceData.mockResolvedValue({ spans: 0, summaries: 0, evals: 0 });
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    stopTraceCleanupJob();
    vi.useRealTimers();
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
  });

  describe("runTraceCleanupOnce", () => {
    it("uses the 30-day default cutoff when the env var is unset", async () => {
      vi.useFakeTimers();
      const now = 1_000_000_000_000;
      vi.setSystemTime(now);

      await runTraceCleanupOnce();

      expect(deleteOldTraceData).toHaveBeenCalledTimes(1);
      const cutoff = deleteOldTraceData.mock.calls[0][0] as number;
      expect(cutoff).toBe(now - 30 * ONE_DAY_MS);
    });

    it("honors a custom retention window from the env var", async () => {
      process.env[ENV_KEY] = "7";
      vi.useFakeTimers();
      const now = 2_000_000_000_000;
      vi.setSystemTime(now);

      await runTraceCleanupOnce();

      const cutoff = deleteOldTraceData.mock.calls[0][0] as number;
      expect(cutoff).toBe(now - 7 * ONE_DAY_MS);
    });

    it("returns null and does NOT purge when retention is disabled (=0)", async () => {
      // 0 is the documented escape hatch for dev/debugging. It must never
      // issue a delete — otherwise "disabled" would still destroy data.
      process.env[ENV_KEY] = "0";

      const result = await runTraceCleanupOnce();

      expect(result).toBeNull();
      expect(deleteOldTraceData).not.toHaveBeenCalled();
    });

    it("falls back to the default for non-numeric or negative values", async () => {
      vi.useFakeTimers();
      const now = 3_000_000_000_000;
      vi.setSystemTime(now);

      for (const bad of ["abc", "-5", ""]) {
        deleteOldTraceData.mockClear();
        process.env[ENV_KEY] = bad;
        await runTraceCleanupOnce();
        const cutoff = deleteOldTraceData.mock.calls[0][0] as number;
        expect(cutoff).toBe(now - 30 * ONE_DAY_MS);
      }
    });

    it("propagates the per-table deletion counts from the store", async () => {
      deleteOldTraceData.mockResolvedValue({
        spans: 12,
        summaries: 3,
        evals: 7,
      });
      const result = await runTraceCleanupOnce();
      expect(result).toEqual({ spans: 12, summaries: 3, evals: 7 });
    });
  });

  describe("startTraceCleanupJob scheduler", () => {
    it("runs the first purge only after the startup delay, then daily", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      startTraceCleanupJob();

      // Nothing fires immediately — the startup delay protects bootstrap.
      expect(deleteOldTraceData).not.toHaveBeenCalled();

      // After the 5-minute startup delay, the first sweep runs.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(deleteOldTraceData).toHaveBeenCalledTimes(1);

      // Then a sweep every 24h.
      await vi.advanceTimersByTimeAsync(ONE_DAY_MS);
      expect(deleteOldTraceData).toHaveBeenCalledTimes(2);
    });

    it("is idempotent: a second start does not double-schedule", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      startTraceCleanupJob();
      startTraceCleanupJob();

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      // One scheduler => one sweep, not two.
      expect(deleteOldTraceData).toHaveBeenCalledTimes(1);
    });

    it("schedules nothing when retention is disabled", async () => {
      process.env[ENV_KEY] = "0";
      vi.useFakeTimers();

      startTraceCleanupJob();
      await vi.advanceTimersByTimeAsync(10 * ONE_DAY_MS);

      expect(deleteOldTraceData).not.toHaveBeenCalled();
    });

    it("stopTraceCleanupJob cancels a pending startup purge", async () => {
      vi.useFakeTimers();

      startTraceCleanupJob();
      stopTraceCleanupJob();

      await vi.advanceTimersByTimeAsync(10 * ONE_DAY_MS);
      expect(deleteOldTraceData).not.toHaveBeenCalled();
    });
  });
});
