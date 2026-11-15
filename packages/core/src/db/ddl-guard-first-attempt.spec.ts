import { afterEach, describe, expect, it, vi } from "vitest";

import type { DbExec } from "./client.js";
import { ensureSchemaObject, ensureTableExists } from "./ddl-guard.js";

function recordingClient(
  handler: (sql: string) => { rows: unknown[] } | undefined,
) {
  const calls: string[] = [];
  const client: DbExec = {
    execute: async (statement) => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      calls.push(sql);
      return { rows: handler(sql)?.rows ?? [], rowsAffected: 0 };
    },
    transaction: async (run) => {
      calls.push("BEGIN");
      try {
        const result = await run(client);
        calls.push("COMMIT");
        return result;
      } catch (error) {
        calls.push("ROLLBACK");
        throw error;
      }
    },
  };
  return { client, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("first-attempt DDL races", () => {
  it.each([true, false, undefined, "throws"] as const)(
    "re-probes a first-attempt duplicate and handles %s",
    async (result) => {
      const duplicate = Object.assign(new Error("column already exists"), {
        code: "42701",
      });
      const probeError = new Error("schema probe failed");
      const { client, calls } = recordingClient((sql) => {
        if (/ALTER TABLE/.test(sql)) throw duplicate;
        return undefined;
      });
      const probe = vi.fn().mockResolvedValueOnce(false);
      if (result === "throws") probe.mockRejectedValueOnce(probeError);
      else probe.mockResolvedValueOnce(result);
      const outcome = await ensureSchemaObject({
        probe,
        ddl: "ALTER TABLE foo ADD COLUMN bar TEXT",
        label: "column foo.bar",
        injectedClient: client,
      }).catch((error: unknown) => error);
      if (result === true) expect(outcome).toBe(true);
      else if (result === false) expect(outcome).toBe(duplicate);
      else if (result === "throws") {
        expect(outcome).toBeInstanceOf(AggregateError);
        expect((outcome as AggregateError).errors).toEqual([
          duplicate,
          probeError,
        ]);
      } else {
        expect(outcome).toMatchObject({
          message: expect.stringMatching(/could not re-probe/),
          cause: duplicate,
        });
      }
      expect(probe).toHaveBeenCalledTimes(2);
      expect(calls.filter((sql) => /ALTER TABLE/.test(sql))).toHaveLength(1);
      expect(calls.filter((sql) => sql === "ROLLBACK")).toHaveLength(1);
    },
  );

  it("refreshes the schema snapshot when a concurrent creator wins before the first DDL", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/db");
    let created = false;
    const { client, calls } = recordingClient((sql) => {
      if (/FROM information_schema\.columns/.test(sql)) {
        return {
          rows: created ? [{ table_name: "foo", column_name: "id" }] : [],
        };
      }
      if (/CREATE TABLE/.test(sql)) {
        created = true;
        throw Object.assign(new Error("concurrent DDL"), { code: "42P07" });
      }
      return undefined;
    });
    await expect(
      ensureTableExists("foo", "CREATE TABLE foo (id TEXT)", {
        injectedClient: client,
      }),
    ).resolves.toBe(true);
    expect(
      calls.filter((sql) => /FROM information_schema\.columns/.test(sql)),
    ).toHaveLength(2);
    expect(calls.filter((sql) => /CREATE TABLE/.test(sql))).toHaveLength(1);
    expect(calls).toContain("ROLLBACK");
  });
});
