import { describe, expect, it } from "vitest";

import { defineStore } from "../db/store-registry.js";
import {
  buildStoreMigrationsLock,
  compareStoreMigrationsLocks,
} from "./store-migrations-lock.js";

function lockOf(
  migrations: Array<{ name: string; sql?: string; run?: () => Promise<void> }>,
) {
  return buildStoreMigrationsLock([defineStore({ id: "widgets", migrations })]);
}

const baseline = { name: "baseline", sql: "CREATE TABLE widgets (id TEXT)" };

describe("store migrations lock", () => {
  it("accepts appended migrations", () => {
    const base = lockOf([baseline]);
    const head = lockOf([baseline, { name: "add-name", sql: "SELECT 1" }]);
    expect(compareStoreMigrationsLocks(base, head)).toEqual([]);
  });

  it("rejects edited, renamed, reordered and removed migrations", () => {
    const base = lockOf([baseline, { name: "add-name", sql: "SELECT 1" }]);
    const messages = (head: ReturnType<typeof lockOf>) =>
      compareStoreMigrationsLocks(base, head).map((f) => f.message);

    expect(
      messages(
        lockOf([
          { ...baseline, sql: "CREATE TABLE widgets (id INT)" },
          { name: "add-name", sql: "SELECT 1" },
        ]),
      ),
    ).toEqual([expect.stringMatching(/"baseline" changed its SQL/)]);
    expect(
      messages(lockOf([baseline, { name: "add-title", sql: "SELECT 1" }])),
    ).toEqual([expect.stringMatching(/"add-name" was removed, renamed/)]);
    expect(
      messages(lockOf([{ name: "add-name", sql: "SELECT 1" }, baseline])),
    ).toHaveLength(2);
    expect(compareStoreMigrationsLocks(base, {})).toEqual([
      expect.objectContaining({
        message: expect.stringMatching(/store "widgets" was removed/),
      }),
    ]);
  });

  it("does not checksum run migrations", () => {
    const base = lockOf([{ name: "baseline", run: async () => {} }]);
    const head = lockOf([
      { name: "baseline", run: async () => void (await Promise.resolve()) },
    ]);
    expect(compareStoreMigrationsLocks(base, head)).toEqual([]);
  });
});
