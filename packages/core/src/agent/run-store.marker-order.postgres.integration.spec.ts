import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { toPostgresParams, withDbExec, type DbExec } from "../db/client.js";
import {
  AgentRunEventNotPersistedError,
  getCurrentTurnRunEventsForThread,
  insertRun,
  insertRunEvent,
  reapIfStale,
} from "./run-store.js";
import { classifyToolCallJournal } from "./tool-call-journal.js";

const databaseUrl = process.env.AGENT_RUN_POSTGRES_TEST_URL;

function executor(sql: postgres.Sql): DbExec {
  return {
    async execute(statement) {
      const query =
        typeof statement === "string" ? { sql: statement } : statement;
      const rows = await sql.unsafe(
        toPostgresParams(query.sql),
        query.args as never[],
      );
      return { rows, rowsAffected: rows.count };
    },
    async transaction<T>(run: (tx: DbExec) => Promise<T>): Promise<T> {
      return (await sql.begin((tx) =>
        run(executor(tx as unknown as postgres.Sql)),
      )) as T;
    },
  };
}

describe.skipIf(!databaseUrl)(
  "durable marker ordering on shared PostgreSQL",
  () => {
    it("commits the marker before reaping can expose recovery history", async () => {
      const connections = Array.from({ length: 3 }, () =>
        postgres(databaseUrl!, { max: 1 }),
      );
      const [observer, markerDb, reaperDb] = connections;
      const key = Math.floor(Math.random() * 2_000_000_000);
      const suffix = randomUUID().replaceAll("-", "");
      const runId = `marker-order-${suffix}`;
      const trigger = `marker_gate_${suffix}`;
      let marker: Promise<void> | undefined;
      let reaper: Promise<boolean> | undefined;
      let reaped = false;
      try {
        await withDbExec(executor(observer), () =>
          insertRun(runId, runId, runId),
        );
        await observer.unsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.run_id = '${runId}' AND NEW.seq = 0 THEN
            PERFORM pg_advisory_xact_lock(${key});
          END IF;
          RETURN NEW;
        END $$`);
        await observer.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON agent_run_events
        FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
        await observer`SELECT pg_advisory_lock(${key})`;
        const [{ pid: markerPid }] =
          await markerDb`SELECT pg_backend_pid() AS pid`;
        const [{ pid: reaperPid }] =
          await reaperDb`SELECT pg_backend_pid() AS pid`;
        marker = withDbExec(executor(markerDb), () =>
          insertRunEvent(
            runId,
            0,
            JSON.stringify({
              type: "tool_start",
              tool: "send-email",
              id: "send-1",
              input: {},
            }),
            { requireInserted: true },
          ),
        );
        await expect
          .poll(async () => {
            const [row] =
              await observer`SELECT wait_event FROM pg_stat_activity WHERE pid = ${markerPid}`;
            return row.wait_event;
          })
          .toBe("advisory");
        reaper = withDbExec(executor(reaperDb), () => reapIfStale(runId, 0));
        void reaper.then(() => {
          reaped = true;
        });
        await expect
          .poll(async () => {
            const [row] =
              await observer`SELECT ${markerPid} = ANY(pg_blocking_pids(${reaperPid})) AS blocked`;
            return reaped ? "reaped" : row.blocked ? "blocked" : "pending";
          })
          .toBe("blocked");
        const [running] =
          await observer`SELECT status FROM agent_runs WHERE id = ${runId}`;
        expect(running.status).toBe("running");
        await observer`SELECT pg_advisory_unlock(${key})`;
        await marker;
        expect(await reaper).toBe(true);
        const events = await withDbExec(executor(observer), () =>
          getCurrentTurnRunEventsForThread(runId, runId),
        );
        expect(
          events.some(
            ({ event }) => event.type === "tool_start" && event.id === "send-1",
          ),
        ).toBe(true);
        expect(
          classifyToolCallJournal(events.map(({ event }) => event)).interrupted,
        ).toContainEqual(
          expect.objectContaining({ tool: "send-email", id: "send-1" }),
        );
      } finally {
        await observer`SELECT pg_advisory_unlock(${key})`;
        await Promise.allSettled([marker, reaper]);
        await observer.unsafe(
          `DROP TRIGGER IF EXISTS ${trigger} ON agent_run_events`,
        );
        await observer.unsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
        await observer`DELETE FROM agent_run_events WHERE run_id = ${runId}`;
        await observer`DELETE FROM agent_runs WHERE id = ${runId}`;
        await Promise.all(connections.map((sql) => sql.end()));
      }
    });

    it("rejects the marker when a terminal status commits first", async () => {
      const connections = Array.from({ length: 3 }, () =>
        postgres(databaseUrl!, { max: 1 }),
      );
      const [observer, markerDb, reaperDb] = connections;
      const runId = `marker-terminal-${randomUUID()}`;
      let marker: Promise<void> | undefined;
      try {
        await withDbExec(executor(observer), () =>
          insertRun(runId, runId, runId),
        );
        const [{ pid: markerPid }] =
          await markerDb`SELECT pg_backend_pid() AS pid`;
        const [{ pid: reaperPid }] =
          await reaperDb`SELECT pg_backend_pid() AS pid`;
        await reaperDb`BEGIN`;
        await reaperDb`UPDATE agent_runs SET status = 'errored' WHERE id = ${runId}`;
        marker = withDbExec(executor(markerDb), () =>
          insertRunEvent(
            runId,
            0,
            JSON.stringify({
              type: "tool_start",
              tool: "send-email",
              id: "send-1",
              input: {},
            }),
            { requireInserted: true },
          ),
        );
        let settled = false;
        void marker.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await expect
          .poll(async () => {
            const [row] =
              await observer`SELECT ${reaperPid} = ANY(pg_blocking_pids(${markerPid})) AS blocked`;
            return settled ? "settled" : row.blocked ? "blocked" : "pending";
          })
          .toBe("blocked");
        await reaperDb`COMMIT`;
        await expect(marker).rejects.toBeInstanceOf(
          AgentRunEventNotPersistedError,
        );
        const rows =
          await observer`SELECT seq FROM agent_run_events WHERE run_id = ${runId}`;
        expect(rows).toHaveLength(0);
      } finally {
        await reaperDb`ROLLBACK`;
        await Promise.allSettled([marker]);
        await observer`DELETE FROM agent_run_events WHERE run_id = ${runId}`;
        await observer`DELETE FROM agent_runs WHERE id = ${runId}`;
        await Promise.all(connections.map((sql) => sql.end()));
      }
    });
  },
);
