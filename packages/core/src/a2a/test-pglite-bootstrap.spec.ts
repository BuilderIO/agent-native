import { describe, expect, it } from "vitest";

import { createTestPglite } from "./test-pglite.js";

describe("empty database bootstrap fixtures", () => {
  it("keeps concurrent schemas, rows, sequences and session settings independent", async () => {
    const acquired = await Promise.allSettled([
      createTestPglite({ reuseEmptyBootstrap: true }),
      createTestPglite({ reuseEmptyBootstrap: true }),
    ] as const);
    if (
      acquired[0].status !== "fulfilled" ||
      acquired[1].status !== "fulfilled"
    ) {
      await Promise.allSettled(
        acquired.flatMap((result) =>
          result.status === "fulfilled" ? [result.value.close()] : [],
        ),
      );
      throw new Error("Concurrent fixture acquisition failed");
    }
    const left = acquired[0].value;
    const right = acquired[1].value;
    let leftClosed = false;
    try {
      await left.exec(
        "CREATE TABLE fixture_probe (id SERIAL PRIMARY KEY, note TEXT)",
      );
      await left.exec("INSERT INTO fixture_probe(note) VALUES ('left')");
      await left.exec("SET app.fixture_marker = 'left'");
      expect(
        (
          await right.query(
            "SELECT to_regclass('public.fixture_probe')::TEXT AS name",
          )
        ).rows,
      ).toEqual([{ name: null }]);
      expect(
        (
          await right.query(
            "SELECT current_setting('app.fixture_marker', true) AS value",
          )
        ).rows,
      ).toEqual([{ value: null }]);
      await right.exec(
        "CREATE TABLE fixture_probe (id SERIAL PRIMARY KEY, note TEXT)",
      );
      await right.exec("INSERT INTO fixture_probe(note) VALUES ('right')");
      expect(
        (await left.query("SELECT id, note FROM fixture_probe")).rows,
      ).toEqual([{ id: 1, note: "left" }]);
      expect(
        (await right.query("SELECT id, note FROM fixture_probe")).rows,
      ).toEqual([{ id: 1, note: "right" }]);
      await left.close();
      leftClosed = true;
      await right.exec(
        "INSERT INTO fixture_probe(note) VALUES ('after peer close')",
      );
      expect(
        (await right.query("SELECT id FROM fixture_probe ORDER BY id")).rows,
      ).toEqual([{ id: 1 }, { id: 2 }]);
    } finally {
      const closed = await Promise.allSettled([
        ...(leftClosed ? [] : [left.close()]),
        right.close(),
      ]);
      const failed = closed.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
  });

  it("does not let committed or rolled-back test data enter later fixtures", async () => {
    const first = await createTestPglite({ reuseEmptyBootstrap: true });
    try {
      await first.exec("CREATE TABLE fixture_probe(id INTEGER PRIMARY KEY)");
      await expect(
        first.transaction(async (tx) => {
          await tx.execute("INSERT INTO fixture_probe VALUES(1)");
          throw new Error("intentional fixture rollback");
        }),
      ).rejects.toThrow("intentional fixture rollback");
      expect((await first.query("SELECT * FROM fixture_probe")).rows).toEqual(
        [],
      );
      await first.exec("INSERT INTO fixture_probe VALUES(2)");
    } finally {
      await first.close();
    }
    for (const options of [{ reuseEmptyBootstrap: true }, undefined]) {
      const next = await createTestPglite(options);
      try {
        expect(
          (
            await next.query(
              "SELECT count(*)::INTEGER AS count FROM information_schema.tables WHERE table_schema='public'",
            )
          ).rows,
        ).toEqual([{ count: 0 }]);
      } finally {
        await next.close();
      }
    }
  });
});
