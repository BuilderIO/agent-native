import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const schema =
    await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js");
  return { getDb: getDbMock, schema };
});

import * as dbModule from "../db/index.js";
import * as store from "./key-dates-store.js";

const alice = { email: "alice@example.test", orgId: "org-1" };
const bob = { email: "bob@example.test", orgId: "org-1" };
const otherOrg = { email: "carol@example.test", orgId: "org-2" };
const alicePersonal = { email: "alice@example.test", orgId: null };
const bobPersonal = { email: "bob@example.test", orgId: null };

const productHunt = {
  setName: "Launches",
  date: "2026-10-14",
  time: "00:01",
  timeZone: "America/Los_Angeles",
  label: "Product Hunt live",
};

describe("key-dates store", () => {
  type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
  let client: PGliteClient;

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    getDbMock.mockReset();
    getDbMock.mockReturnValue(drizzle(client, { schema: dbModule.schema }));
    for (let run = 0; run < 2; run++) {
      for (const statement of store.KEY_DATES_MIGRATION_SQL) {
        await client.exec(statement);
      }
    }
  });

  afterEach(async () => {
    await client.close();
  });

  it("creates a set by name with its first date, then reuses it", async () => {
    const first = await store.saveKeyDate(alice, productHunt);
    const second = await store.saveKeyDate(alice, {
      setName: "launches",
      date: "2026-10-14",
      time: "12:00",
      timeZone: "America/New_York",
      label: "Launch posts on X, LinkedIn",
    });

    expect(first).toMatchObject({
      setName: "Launches",
      date: "2026-10-14",
      time: "00:01",
      timeZone: "America/Los_Angeles",
      addedBy: "alice@example.test",
    });
    expect(second.setId).toBe(first.setId);
    const sets = await store.listKeyDateSets(alice);
    expect(sets).toHaveLength(1);
    expect(sets[0].dates.map((date) => [date.time, date.label])).toEqual([
      ["00:01", "Product Hunt live"],
      ["12:00", "Launch posts on X, LinkedIn"],
    ]);
  });

  it("shares an organization's sets with its members and no one else", async () => {
    const saved = await store.saveKeyDate(alice, productHunt);

    expect((await store.listKeyDateSets(bob)).map((set) => set.name)).toEqual([
      "Launches",
    ]);
    await store.saveKeyDate(bob, {
      ...productHunt,
      id: saved.id,
      label: "Product Hunt launch",
    });
    expect((await store.listKeyDateSets(alice))[0].dates[0].label).toBe(
      "Product Hunt launch",
    );

    expect(await store.listKeyDateSets(otherOrg)).toEqual([]);
    expect(await store.listKeyDateSets(alicePersonal)).toEqual([]);
    await expect(store.deleteKeyDate(otherOrg, saved.id)).rejects.toMatchObject(
      { statusCode: 404 },
    );
  });

  it("keeps a user's sets private when there is no organization", async () => {
    await store.saveKeyDate(alicePersonal, productHunt);

    expect(await store.listKeyDateSets(alicePersonal)).toHaveLength(1);
    expect(await store.listKeyDateSets(bobPersonal)).toEqual([]);
    expect(await store.listKeyDateSets(alice)).toEqual([]);
  });

  it("refuses a second set with the same name and renames by id", async () => {
    const launches = await store.saveKeyDateSet(alice, { name: "Launches" });
    const changes = await store.saveKeyDateSet(alice, {
      name: "Product changes",
    });

    await expect(
      store.saveKeyDateSet(alice, { name: " launches " }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "duplicate_key_date_set",
    });
    await expect(
      store.saveKeyDateSet(alice, { id: changes.id, name: "LAUNCHES" }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const renamed = await store.saveKeyDateSet(alice, {
      id: launches.id,
      name: "Launch moments",
    });
    expect(renamed).toMatchObject({ id: launches.id, name: "Launch moments" });
  });

  it("moves a date to another set and deletes a set with its dates", async () => {
    const saved = await store.saveKeyDate(alice, productHunt);
    const changes = await store.saveKeyDateSet(alice, {
      name: "Product changes",
    });
    await store.saveKeyDate(alice, {
      setName: "Product changes",
      date: "2026-09-22",
      label: "Role step first",
    });

    const moved = await store.saveKeyDate(alice, {
      ...productHunt,
      id: saved.id,
      setId: changes.id,
    });
    expect(moved.setName).toBe("Product changes");

    await expect(store.deleteKeyDateSet(alice, changes.id)).resolves.toEqual({
      id: changes.id,
      deletedDates: 2,
    });
    expect(
      (await store.listKeyDateSets(alice)).map((set) => [
        set.name,
        set.dates.length,
      ]),
    ).toEqual([["Launches", 0]]);
    await expect(
      store.deleteKeyDateSet(alice, changes.id),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects malformed dates, times and zones before writing", async () => {
    for (const bad of [
      { date: "Oct 14" },
      { time: "25:00" },
      { timeZone: "Mars/Olympus_Mons" },
      { time: undefined },
      { label: "  " },
    ]) {
      await expect(
        store.saveKeyDate(alice, { ...productHunt, ...bad }),
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: "invalid_key_date",
      });
    }
    await expect(
      store.saveKeyDate(alice, { date: "2026-10-14", label: "No set" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await store.listKeyDateSets(alice)).toEqual([]);
  });
});
