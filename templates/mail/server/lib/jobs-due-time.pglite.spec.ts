import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

type Jobs = typeof import("./jobs.js");
type Exec = {
  execute: (q: { sql: string; args?: unknown[] }) => Promise<unknown>;
};

let jobs: Jobs;
let exec: Exec;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  const [{ default: initializeMailDb }, core, jobsModule] = await Promise.all([
    import("../plugins/db.js"),
    import("@agent-native/core/db"),
    import("./jobs.js"),
  ]);
  await initializeMailDb({});
  exec = core.getDbExec() as unknown as Exec;
  jobs = jobsModule;
});

afterEach(async () => {
  const { closeDbExec } = await import("@agent-native/core/db");
  await closeDbExec();
  Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
  Reflect.deleteProperty(
    globalThis as object,
    "__agentNativePgliteProcessLocks",
  );
  Reflect.deleteProperty(
    globalThis as object,
    "__agentNativePgliteProcessExitCleanupRegistered",
  );
  vi.unstubAllEnvs();
  vi.resetModules();
});

function job(
  id: string,
  fields: {
    type: "snooze" | "send_later";
    status: string;
    runAt: number;
    leaseUntil?: number | null;
    sendStartedAt?: number | null;
  },
) {
  return exec.execute({
    sql: `INSERT INTO scheduled_jobs
          (id, type, payload, run_at, status, created_at,
           processing_lease_until, send_started_at)
          VALUES (?, ?, '{}', ?, ?, 1, ?, ?)`,
    args: [
      id,
      fields.type,
      fields.runAt,
      fields.status,
      fields.leaseUntil ?? null,
      fields.sendStartedAt ?? null,
    ],
  });
}

describe("getNextScheduledJobDueAt (PGlite)", () => {
  it("answers when the sweep can next act on a job", async () => {
    await expect(jobs.getNextScheduledJobDueAt()).resolves.toBeNull();

    await job("finished", { type: "snooze", status: "done", runAt: 1 });
    await job("replay-blocked", {
      type: "send_later",
      status: "pending",
      runAt: 2,
      sendStartedAt: 2,
    });
    await expect(jobs.getNextScheduledJobDueAt()).resolves.toBeNull();

    await job("send-now", {
      type: "send_later",
      status: "processing",
      runAt: 900_000,
      leaseUntil: 20_000,
    });
    await expect(jobs.getNextScheduledJobDueAt()).resolves.toBe(900_000);

    await job("snooze", { type: "snooze", status: "pending", runAt: 500_000 });
    await expect(jobs.getNextScheduledJobDueAt()).resolves.toBe(500_000);

    await job("started-send", {
      type: "send_later",
      status: "processing",
      runAt: 900_000,
      leaseUntil: 300_000,
      sendStartedAt: 10,
    });
    await expect(jobs.getNextScheduledJobDueAt()).resolves.toBe(300_000);

    await job("claimed-snooze", {
      type: "snooze",
      status: "processing",
      runAt: 100_000,
      leaseUntil: 250_000,
    });
    await expect(jobs.getNextScheduledJobDueAt()).resolves.toBe(250_000);

    await job("leaseless-send", {
      type: "send_later",
      status: "processing",
      runAt: 900_000,
      sendStartedAt: 10,
    });
    await expect(jobs.getNextScheduledJobDueAt()).resolves.toBe(0);
  });
});
