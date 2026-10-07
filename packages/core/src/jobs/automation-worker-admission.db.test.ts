import { afterAll, describe, expect, it } from "vitest";

import {
  claimBackgroundRun,
  getRunById,
  insertRun,
  tryClaimRunSlot,
} from "../agent/run-store.js";
import { createDbExec, withDbExec, type DbExec } from "../db/client.js";
import {
  attachAutomationRunThread,
  getAutomationRun,
  startAutomationRun,
} from "./run-history.js";

const db = await createDbExec({ url: "pglite:memory://" });
afterAll(async () => {
  await db.close?.();
});

describe("atomic automation worker admission", () => {
  it.each(["fresh", "resumed"])(
    "rolls back the %s worker and history link if setup fails before commit",
    async (mode) => {
      await withDbExec(db, async () => {
        const threadId = `thread-${mode}`;
        const runId = `worker-${mode}`;
        const previousRunId =
          mode === "resumed" ? "previous-worker" : undefined;
        const historyId = await startAutomationRun({
          owner: "owner@example.com",
          automation: mode,
          path: `jobs/${mode}.md`,
          ...(previousRunId ? { threadId, runId: previousRunId } : {}),
        });
        const afterInsert = (tx: DbExec) =>
          withDbExec(tx, async () => {
            await attachAutomationRunThread(historyId, threadId, runId, {
              requirePersisted: true,
            });
            expect(await claimBackgroundRun(runId)).toBe(true);
            throw new Error("worker setup interrupted before commit");
          });
        const admit = () =>
          mode === "fresh"
            ? insertRun(runId, threadId, runId, {
                dispatchMode: "background",
                afterInsert,
              })
            : tryClaimRunSlot(threadId, runId, undefined, {
                turnId: "previous-worker",
                dispatchMode: "background",
                afterInsert,
              });
        await expect(admit()).rejects.toThrow(
          "worker setup interrupted before commit",
        );
        expect(await getRunById(runId)).toBeNull();
        expect((await getAutomationRun(historyId))?.runId).toBe(
          previousRunId ?? null,
        );
        expect((await getAutomationRun(historyId))?.finishedAt).toBeNull();
      });
    },
  );

  it("commits the worker claim and strict history link together", async () => {
    await withDbExec(db, async () => {
      const historyId = await startAutomationRun({
        owner: "owner@example.com",
        automation: "committed",
        path: "jobs/committed.md",
      });
      await insertRun(
        "committed-worker",
        "committed-thread",
        "committed-turn",
        {
          dispatchMode: "background",
          afterInsert: (tx) =>
            withDbExec(tx, async () => {
              await attachAutomationRunThread(
                historyId,
                "committed-thread",
                "committed-worker",
                { requirePersisted: true },
              );
              expect(await claimBackgroundRun("committed-worker")).toBe(true);
            }),
        },
      );
      expect(await getRunById("committed-worker")).toMatchObject({
        status: "running",
      });
      const claimed = await db.execute({
        sql: "SELECT dispatch_mode FROM agent_runs WHERE id = ?",
        args: ["committed-worker"],
      });
      expect(claimed.rows[0]?.dispatch_mode).toBe("background-processing");
      expect(await getAutomationRun(historyId)).toMatchObject({
        runId: "committed-worker",
        threadId: "committed-thread",
      });
    });
  });

  it("does not mutate the history link when another worker owns the resumed slot", async () => {
    await withDbExec(db, async () => {
      await insertRun("active-worker", "occupied-thread", "occupied-turn");
      const historyId = await startAutomationRun({
        owner: "owner@example.com",
        automation: "occupied",
        path: "jobs/occupied.md",
        threadId: "occupied-thread",
        runId: "active-worker",
      });
      let attached = false;
      const result = await tryClaimRunSlot(
        "occupied-thread",
        "losing-worker",
        undefined,
        {
          turnId: "occupied-turn",
          afterInsert: (tx) =>
            withDbExec(tx, async () => {
              attached = true;
              await attachAutomationRunThread(
                historyId,
                "occupied-thread",
                "losing-worker",
                { requirePersisted: true },
              );
            }),
        },
      );
      expect(result.claimed).toBe(false);
      expect(attached).toBe(false);
      expect(await getRunById("losing-worker")).toBeNull();
      expect((await getAutomationRun(historyId))?.runId).toBe("active-worker");
    });
  });
});
