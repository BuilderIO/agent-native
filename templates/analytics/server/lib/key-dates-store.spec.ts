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
import { KEY_DATES_MIGRATION_SQL } from "./key-dates-migration.js";
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
  let queries: { query: string; params: unknown[] }[];

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    queries = [];
    getDbMock.mockReset();
    getDbMock.mockReturnValue(
      drizzle(client, {
        schema: dbModule.schema,
        logger: {
          logQuery: (query, params) => queries.push({ query, params }),
        },
      }),
    );
    for (let run = 0; run < 2; run++) {
      for (const statement of KEY_DATES_MIGRATION_SQL) {
        await client.exec(statement);
      }
    }
  });

  afterEach(async () => {
    await client.close();
  });

  const seedSets = (total: number) =>
    client.query(
      `INSERT INTO analytics_key_date_sets (id, org_id, owner_email, name)
       SELECT 'seed-set-' || n, $1, $2, 'Seed ' || n FROM generate_series(1, $3::int) n`,
      [alice.orgId, alice.email, total],
    );

  const seedDates = (setId: string, total: number) =>
    client.query(
      `INSERT INTO analytics_key_dates (id, set_id, org_id, owner_email, date, label)
       SELECT 'seed-date-' || n, $1, $2, $3, '2026-01-01', 'Seed ' || n FROM generate_series(1, $4::int) n`,
      [setId, alice.orgId, alice.email, total],
    );

  const rejections = (results: PromiseSettledResult<unknown>[]) =>
    results.flatMap((result) =>
      result.status === "rejected"
        ? [(result.reason as { errorCode?: string }).errorCode]
        : [],
    );

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

  it("rejects a day the calendar does not have before writing", async () => {
    await expect(
      store.saveKeyDate(alice, { ...productHunt, date: "2026-02-30" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "invalid_key_date",
    });
    expect(queries).toEqual([]);
    expect(await store.listKeyDateSets(alice)).toEqual([]);
  });

  it("says why it rejects a time the clocks skip for daylight saving", async () => {
    await expect(
      store.saveKeyDate(alice, {
        ...productHunt,
        date: "2026-03-08",
        time: "02:30",
        timeZone: "America/New_York",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "invalid_key_date",
      message: expect.stringContaining(
        "time 02:30 does not exist on 2026-03-08 in America/New_York",
      ),
    });
    expect(queries).toEqual([]);
  });

  it("keeps an edited date in its set when no set is named", async () => {
    const saved = await store.saveKeyDate(alice, productHunt);

    const edited = await store.saveKeyDate(alice, {
      id: saved.id,
      date: "2026-10-15",
      label: "Product Hunt recap",
    });

    expect(edited).toMatchObject({
      id: saved.id,
      setId: saved.setId,
      setName: "Launches",
      date: "2026-10-15",
      label: "Product Hunt recap",
    });
    await expect(
      store.saveKeyDate(otherOrg, {
        id: saved.id,
        date: "2026-10-15",
        label: "Not theirs",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses an edit made from a copy someone has saved over since", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
      const opened = await store.saveKeyDate(alice, productHunt);
      vi.setSystemTime(new Date("2026-10-14T12:05:00Z"));
      await store.saveKeyDate(bob, {
        id: opened.id,
        date: "2026-10-14",
        label: "Product Hunt launch",
        expectedUpdatedAt: opened.updatedAt,
      });

      await expect(
        store.saveKeyDate(alice, {
          id: opened.id,
          date: "2026-10-15",
          label: "Product Hunt live",
          expectedUpdatedAt: opened.updatedAt,
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "annotation_conflict",
      });
      expect((await store.listKeyDateSets(alice))[0].dates).toMatchObject([
        { id: opened.id, date: "2026-10-14", label: "Product Hunt launch" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a date's time and zone when an edit leaves them out", async () => {
    const saved = await store.saveKeyDate(alice, productHunt);

    const relabeled = await store.saveKeyDate(alice, {
      id: saved.id,
      date: "2026-10-14",
      label: "Product Hunt launch",
    });
    expect(relabeled).toMatchObject({
      time: "00:01",
      timeZone: "America/Los_Angeles",
      label: "Product Hunt launch",
    });

    const retimed = await store.saveKeyDate(alice, {
      id: saved.id,
      date: "2026-10-14",
      time: "09:00",
      label: "Product Hunt launch",
    });
    expect(retimed).toMatchObject({
      time: "09:00",
      timeZone: "America/Los_Angeles",
    });
  });

  it("clears a time or zone only when an edit sends null, and a time takes its zone with it", async () => {
    const saved = await store.saveKeyDate(alice, productHunt);
    const edit = { id: saved.id, date: "2026-10-14", label: "Launch" };

    const utc = await store.saveKeyDate(alice, { ...edit, timeZone: null });
    expect(utc.time).toBe("00:01");
    expect(utc).not.toHaveProperty("timeZone");

    await store.saveKeyDate(alice, { ...edit, time: "00:01", timeZone: "UTC" });
    const allDay = await store.saveKeyDate(alice, { ...edit, time: null });
    expect(allDay).not.toHaveProperty("time");
    expect(allDay).not.toHaveProperty("timeZone");

    await expect(
      store.saveKeyDate(alice, {
        ...edit,
        time: null,
        timeZone: "America/New_York",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "invalid_key_date",
      message: expect.stringContaining("timeZone needs a time"),
    });
  });

  it("refuses an empty time or zone instead of saving the date untimed or in UTC", async () => {
    for (const [bad, problem] of [
      [{ time: "10:00", timeZone: "" }, "timeZone must be an IANA zone"],
      [{ time: "" }, 'time must be a 24-hour "HH:MM"'],
    ] as const) {
      await expect(
        store.saveKeyDate(alice, { ...productHunt, ...bad }),
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: "invalid_key_date",
        message: expect.stringContaining(`Invalid key date: ${problem}`),
      });
    }
    expect(queries).toEqual([]);

    const saved = await store.saveKeyDate(alice, productHunt);
    await expect(
      store.saveKeyDate(alice, {
        id: saved.id,
        date: saved.date,
        label: saved.label,
        timeZone: "",
      }),
    ).rejects.toMatchObject({ statusCode: 400, errorCode: "invalid_key_date" });
    expect((await store.listKeyDateSets(alice))[0].dates).toMatchObject([
      { time: "00:01", timeZone: "America/Los_Angeles" },
    ]);
  });

  it("locks the organization, or the person without one, before every write", async () => {
    const locks = () =>
      queries.flatMap(({ query, params }) =>
        query.includes("pg_advisory_xact_lock") ? params : [],
      );

    const saved = await store.saveKeyDate(alice, productHunt);
    await store.deleteKeyDate(alice, saved.id);
    await store.saveKeyDateSet(
      { email: "Alice@Example.test", orgId: null },
      { name: "Personal" },
    );

    expect(locks()).toEqual([
      "org:org-1",
      "org:org-1",
      "user:alice@example.test",
    ]);
    expect(queries[0].query).toContain("pg_advisory_xact_lock");
  });

  it("creates one set when the same name is saved at once", async () => {
    const sets = await Promise.allSettled(
      [1, 2, 3].map(() => store.saveKeyDateSet(alice, { name: "Launches" })),
    );
    expect(rejections(sets)).toEqual([
      "duplicate_key_date_set",
      "duplicate_key_date_set",
    ]);

    const saved = await Promise.all(
      ["Clips", "Slides", "Design"].map((label) =>
        store.saveKeyDate(alice, {
          setName: "Product changes",
          date: "2026-10-14",
          label,
        }),
      ),
    );
    expect(new Set(saved.map((date) => date.setId)).size).toBe(1);
    expect((await store.listKeyDateSets(alice)).map((set) => set.name)).toEqual(
      ["Launches", "Product changes"],
    );
  });

  it("stops at the set limit when sets are created at once", async () => {
    await seedSets(store.MAX_KEY_DATE_SETS - 2);

    const created = await Promise.allSettled(
      ["A", "B", "C", "D"].map((name) => store.saveKeyDateSet(alice, { name })),
    );

    expect(rejections(created)).toEqual([
      "key_date_set_limit",
      "key_date_set_limit",
    ]);
    expect(await store.listKeyDateSets(alice)).toHaveLength(
      store.MAX_KEY_DATE_SETS,
    );
  });

  it("stops at the date limit when dates are added at once", async () => {
    const launches = await store.saveKeyDateSet(alice, { name: "Launches" });
    await seedDates(launches.id, store.MAX_KEY_DATES - 2);

    const added = await Promise.allSettled(
      ["A", "B", "C", "D"].map((label) =>
        store.saveKeyDate(alice, {
          setId: launches.id,
          date: "2026-10-14",
          label,
        }),
      ),
    );

    expect(rejections(added)).toEqual(["key_date_limit", "key_date_limit"]);
    const { rows } = await client.query(
      "SELECT count(*)::int AS total FROM analytics_key_dates",
    );
    expect(rows).toEqual([{ total: store.MAX_KEY_DATES }]);
  });

  it("leaves no new set behind when its first date is refused", async () => {
    const launches = await store.saveKeyDateSet(alice, { name: "Launches" });
    await seedDates(launches.id, store.MAX_KEY_DATES);

    await expect(
      store.saveKeyDate(alice, { ...productHunt, setName: "Recaps" }),
    ).rejects.toMatchObject({ statusCode: 409, errorCode: "key_date_limit" });
    expect((await store.listKeyDateSets(alice)).map((set) => set.name)).toEqual(
      ["Launches"],
    );
  });

  it("deletes a set's dates even when one is added to it at the same time", async () => {
    const launches = await store.saveKeyDateSet(alice, { name: "Launches" });

    await Promise.allSettled([
      store.deleteKeyDateSet(alice, launches.id),
      store.saveKeyDate(alice, { ...productHunt, setId: launches.id }),
    ]);

    const { rows } = await client.query(
      "SELECT id FROM analytics_key_dates WHERE set_id = $1",
      [launches.id],
    );
    expect(rows).toEqual([]);
  });
});
