import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MAX_IDLE_TXN_AGE_S,
  MAX_SAME_QUERY_CONCURRENCY,
  MAX_TRIVIAL_QUERY_MS,
  dbPressureWarnings,
  probeDbPressure,
} from "./db-pressure.js";

const HEALTHY = {
  connections: 8,
  idleInTxn: 0,
  oldestIdleTxnS: 0,
  maxSameQuery: 1,
  trivialQueryMs: 128,
};

describe("dbPressureWarnings", () => {
  it("stays quiet on a healthy database", () => {
    expect(dbPressureWarnings(HEALTHY)).toEqual([]);
  });

  it("names all three signals from the 2026-08-06 outage", () => {
    const warnings = dbPressureWarnings({
      connections: 24,
      idleInTxn: 20,
      oldestIdleTxnS: 283,
      maxSameQuery: 56,
      trivialQueryMs: 6000,
    });
    expect(warnings).toHaveLength(3);
    expect(warnings.join(" ")).toContain("idle-in-transaction");
    expect(warnings.join(" ")).toContain("the database itself is slow");
    expect(warnings.join(" ")).toContain("stampeding");
  });

  it("ignores brief idle transactions, which are normal", () => {
    expect(
      dbPressureWarnings({ ...HEALTHY, idleInTxn: 3, oldestIdleTxnS: 2 }),
    ).toEqual([]);
  });
});

describe("probeDbPressure", () => {
  const row = {
    connections: 8,
    idle_in_txn: 0,
    oldest_idle_txn_s: 0,
    max_same_query: 1,
  };

  it("measures counters on postgres", async () => {
    const result = await probeDbPressure(
      { execute: async () => ({ rows: [row] }) },
      "postgres",
    );
    expect(result).toMatchObject({ measured: true, connections: 8 });
  });

  it("accepts string counters from drivers that widen bigints", async () => {
    const result = await probeDbPressure(
      {
        execute: async () => ({
          rows: [{ ...row, connections: "8", max_same_query: "1" }],
        }),
      },
      "postgres",
    );
    expect(result).toMatchObject({ measured: true, connections: 8 });
  });

  // Each of the next four would, if folded into a zeroed "measured" result,
  // report a database nobody looked at as a healthy one.
  it("reports non-postgres as unmeasured, not healthy", async () => {
    const result = await probeDbPressure(
      {
        execute: async () => {
          throw new Error("no such table: pg_stat_activity");
        },
      },
      "sqlite",
    );
    expect(result).toEqual({
      measured: false,
      reason: "dialect sqlite has no pg_stat_activity",
    });
  });

  it("reports a throwing query as unmeasured", async () => {
    const result = await probeDbPressure(
      {
        execute: async () => {
          throw new Error("permission denied for pg_stat_activity");
        },
      },
      "postgres",
    );
    expect(result).toMatchObject({ measured: false });
    expect((result as { reason: string }).reason).toContain(
      "permission denied",
    );
  });

  it("reports an empty result set as unmeasured", async () => {
    const result = await probeDbPressure(
      { execute: async () => ({ rows: [] }) },
      "postgres",
    );
    expect(result).toEqual({
      measured: false,
      reason: "pressure query returned no rows",
    });
  });

  it("reports missing columns as unmeasured", async () => {
    const result = await probeDbPressure(
      { execute: async () => ({ rows: [{ connections: 8 }] }) },
      "postgres",
    );
    expect(result).toEqual({
      measured: false,
      reason: "pressure query returned unreadable counters",
    });
  });
});

describe("threshold parity with scripts/chat-health.mjs", () => {
  // Same three signals are measured from a workstation by chat-health.mjs
  // against every app's database at once, and from inside each app by the code
  // above for the scheduled fleet audit. Two copies of a number is how the two
  // start disagreeing about whether production is healthy.
  it("keeps both copies of the outage thresholds equal", () => {
    const script = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../scripts/chat-health.mjs",
      ),
      "utf8",
    );
    const literal = (name: string) => {
      const match = new RegExp(`const ${name} = ([0-9_]+);`).exec(script);
      if (!match)
        throw new Error(`${name} not found in scripts/chat-health.mjs`);
      return Number(match[1].replace(/_/g, ""));
    };
    expect(literal("MAX_IDLE_TXN_AGE_S")).toBe(MAX_IDLE_TXN_AGE_S);
    expect(literal("MAX_TRIVIAL_QUERY_MS")).toBe(MAX_TRIVIAL_QUERY_MS);
    expect(literal("MAX_SAME_QUERY_CONCURRENCY")).toBe(
      MAX_SAME_QUERY_CONCURRENCY,
    );
  });
});
