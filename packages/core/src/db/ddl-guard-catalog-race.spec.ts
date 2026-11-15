import { describe, expect, it, vi } from "vitest";

import type { DbExec } from "./client.js";
import { ensureSchemaObject } from "./ddl-guard.js";

describe("wrapped PostgreSQL catalog races", () => {
  it.each([
    [
      "pg_type unique conflict",
      { code: "23505", constraint_name: "pg_type_typname_nsp_index" },
    ],
    [
      "pg_class unique conflict",
      { code: "23505", constraint: "pg_class_relname_nsp_index" },
    ],
    ["TypeCreate duplicate", { code: "42710", routine: "TypeCreate" }],
  ])(
    "accepts a wrapped %s after a retry when the object exists",
    async (_label, fields) => {
      let attempts = 0;
      const calls: string[] = [];
      const client: DbExec = {
        execute: async (statement) => {
          const sql = typeof statement === "string" ? statement : statement.sql;
          calls.push(sql);
          if (/CREATE TABLE/.test(sql)) {
            if (++attempts === 1)
              throw Object.assign(new Error("lock timeout"), { code: "55P03" });
            throw new Error("failed query", {
              cause: Object.assign(new Error("catalog conflict"), fields),
            });
          }
          return { rows: [], rowsAffected: 0 };
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
      const probe = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      await expect(
        ensureSchemaObject({
          probe,
          ddl: "CREATE TABLE foo (id TEXT)",
          label: "table foo",
          injectedClient: client,
        }),
      ).resolves.toBe(true);
      expect(attempts).toBe(2);
      expect(probe).toHaveBeenCalledTimes(3);
      expect(calls.filter((sql) => sql === "ROLLBACK")).toHaveLength(2);
    },
  );
});
