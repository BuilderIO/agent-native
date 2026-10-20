import { createRequire } from "node:module";

import { sql } from "drizzle-orm";
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

import { SETUP_INCIDENT } from "../../shared/annotation-fixtures.js";
import * as dbModule from "../db/index.js";
import { lockAnnotationScope } from "./annotation-scope.js";
import { DATA_NOTES_MIGRATION_SQL } from "./data-notes-migration.js";
import * as store from "./data-notes-store.js";

const alice = { email: "alice@example.test", orgId: "org-1" };
const bob = { email: "bob@example.test", orgId: "org-1" };
const otherOrg = { email: "carol@example.test", orgId: "org-2" };
const alicePersonal = { email: "alice@example.test", orgId: null };
const bobPersonal = { email: "bob@example.test", orgId: null };

const incident = {
  kind: SETUP_INCIDENT.kind,
  title: SETUP_INCIDENT.title,
  note: SETUP_INCIDENT.note,
  startDate: SETUP_INCIDENT.startDate,
  matchEvents: ["builder_connect_failed", " builder_connect_failed "],
};

describe("data-notes store", () => {
  type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
  let client: PGliteClient;
  let queries: { query: string; params: unknown[] }[];

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    getDbMock.mockReset();
    queries = [];
    getDbMock.mockReturnValue(
      drizzle(client, {
        schema: dbModule.schema,
        logger: {
          logQuery: (query, params) => queries.push({ query, params }),
        },
      }),
    );
    for (let run = 0; run < 2; run++) {
      for (const statement of DATA_NOTES_MIGRATION_SQL) {
        await client.exec(statement);
      }
    }
  });

  afterEach(async () => {
    await client.close();
  });

  it("adds an ongoing note, then marks it fixed by changing only those fields", async () => {
    const added = await store.saveDataNote(alice, incident);
    expect(added).toMatchObject({
      kind: "incident",
      title: "Builder.io account setup failures",
      startDate: "2026-10-09",
      status: "open",
      matchEvents: ["builder_connect_failed"],
      unlessEvents: [],
      panels: [],
      addedBy: "alice@example.test",
    });
    expect(added).not.toHaveProperty("endDate");

    const fixed = await store.saveDataNote(alice, {
      id: added.id,
      endDate: "2026-10-13",
      status: "fixed",
      fix: "A deploy on Oct 13.",
    });
    expect(fixed).toMatchObject({
      id: added.id,
      title: added.title,
      note: added.note,
      startDate: "2026-10-09",
      endDate: "2026-10-13",
      status: "fixed",
      fix: "A deploy on Oct 13.",
      matchEvents: ["builder_connect_failed"],
    });

    const reopened = await store.saveDataNote(alice, {
      id: added.id,
      endDate: null,
      status: "open",
      fix: null,
    });
    expect(reopened).not.toHaveProperty("endDate");
    expect(reopened).not.toHaveProperty("fix");
  });

  it("shares an organization's notes with its members and no one else", async () => {
    const added = await store.saveDataNote(alice, incident);

    expect((await store.listDataNotes(bob)).map((note) => note.id)).toEqual([
      added.id,
    ]);
    await store.saveDataNote(bob, { id: added.id, title: "Setup failures" });
    expect((await store.listDataNotes(alice))[0].title).toBe("Setup failures");

    expect(await store.listDataNotes(otherOrg)).toEqual([]);
    expect(await store.listDataNotes(alicePersonal)).toEqual([]);
    await expect(
      store.saveDataNote(otherOrg, { id: added.id, title: "Mine now" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      store.deleteDataNote(otherOrg, added.id),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("keeps a user's notes private when there is no organization", async () => {
    await store.saveDataNote(alicePersonal, incident);

    expect(await store.listDataNotes(alicePersonal)).toHaveLength(1);
    expect(await store.listDataNotes(bobPersonal)).toEqual([]);
    expect(await store.listDataNotes(alice)).toEqual([]);
  });

  it("lists newest first, ordering notes with no start by their end", async () => {
    await store.saveDataNote(alice, {
      ...incident,
      title: "Skips untracked",
      startDate: null,
      endDate: "2026-09-17",
    });
    await store.saveDataNote(alice, incident);
    await store.saveDataNote(alice, {
      ...incident,
      title: "Undercount",
      startDate: "2026-10-02",
    });

    expect(
      (await store.listDataNotes(alice)).map((note) => note.title),
    ).toEqual([
      "Builder.io account setup failures",
      "Undercount",
      "Skips untracked",
    ]);
  });

  it("deletes a note", async () => {
    const added = await store.saveDataNote(alice, incident);
    await expect(store.deleteDataNote(alice, added.id)).resolves.toEqual({
      id: added.id,
    });
    expect(await store.listDataNotes(alice)).toEqual([]);
    await expect(store.deleteDataNote(alice, added.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("rejects notes that are incomplete, contradictory, or show on no chart", async () => {
    for (const bad of [
      { kind: undefined },
      { title: "  " },
      { note: "" },
      { startDate: "Oct 9" },
      { startDate: "2026-10-14", endDate: "2026-10-13" },
      { status: "fixed" as const },
      { matchEvents: [] },
      { panels: [{ dashboardId: "dash", panelId: " " }] },
    ]) {
      await expect(
        store.saveDataNote(alice, { ...incident, ...bad }),
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: "invalid_data_note",
      });
    }
    expect(await store.listDataNotes(alice)).toEqual([]);
  });

  it("rejects a day that does not exist instead of rolling it over", async () => {
    await expect(
      store.saveDataNote(alice, { ...incident, startDate: "2026-02-30" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "invalid_data_note",
    });
    const added = await store.saveDataNote(alice, incident);
    await expect(
      store.saveDataNote(alice, { id: added.id, endDate: "2026-02-29" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts a note pinned to a chart with no events", async () => {
    const pinned = await store.saveDataNote(alice, {
      ...incident,
      matchEvents: [],
      panels: [
        { dashboardId: "dash", panelId: "p1" },
        { dashboardId: "dash", panelId: "p1" },
      ],
    });
    expect(pinned.panels).toEqual([{ dashboardId: "dash", panelId: "p1" }]);
  });

  describe("concurrent writes", () => {
    it("keeps both of two edits to different fields", async () => {
      const added = await store.saveDataNote(alice, incident);
      await Promise.all([
        store.saveDataNote(alice, { id: added.id, title: "Setup failures" }),
        store.saveDataNote(bob, {
          id: added.id,
          note: "Setup failed for new accounts.",
        }),
      ]);
      expect((await store.listDataNotes(alice))[0]).toMatchObject({
        title: "Setup failures",
        note: "Setup failed for new accounts.",
      });
    });

    it("refuses an edit made from a copy someone has saved over since", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-10-14T12:00:00Z"));
        const opened = await store.saveDataNote(alice, incident);
        vi.setSystemTime(new Date("2026-10-14T12:05:00Z"));
        await store.saveDataNote(bob, {
          id: opened.id,
          status: "fixed",
          endDate: "2026-10-13",
          expectedUpdatedAt: opened.updatedAt,
        });

        await expect(
          store.saveDataNote(alice, {
            id: opened.id,
            title: "Setup failures",
            status: "open",
            endDate: null,
            expectedUpdatedAt: opened.updatedAt,
          }),
        ).rejects.toMatchObject({
          statusCode: 409,
          errorCode: "annotation_conflict",
        });
        expect((await store.listDataNotes(alice))[0]).toMatchObject({
          title: incident.title,
          status: "fixed",
          endDate: "2026-10-13",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("checks an edit against the note the previous edit left", async () => {
      const added = await store.saveDataNote(alice, incident);
      const [fixed, cleared] = await Promise.allSettled([
        store.saveDataNote(alice, {
          id: added.id,
          status: "fixed",
          endDate: "2026-10-13",
        }),
        store.saveDataNote(bob, { id: added.id, endDate: null }),
      ]);
      expect(fixed.status).toBe("fulfilled");
      expect(cleared).toMatchObject({
        status: "rejected",
        reason: { statusCode: 400, errorCode: "invalid_data_note" },
      });
      expect((await store.listDataNotes(alice))[0]).toMatchObject({
        status: "fixed",
        endDate: "2026-10-13",
      });
    });

    it("holds the note limit when two adds race for the last slot", async () => {
      await client.query(
        `INSERT INTO analytics_data_notes (id, org_id, owner_email, kind, title, note, match_events)
          SELECT 'seed-' || n, $1, $2, 'data', 'Seed', 'Seed', '["seed"]'
          FROM generate_series(1, $3::int) AS n`,
        [alice.orgId, alice.email, store.MAX_DATA_NOTES - 1],
      );
      const results = await Promise.allSettled([
        store.saveDataNote(alice, incident),
        store.saveDataNote(bob, incident),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({
        reason: { statusCode: 409, errorCode: "data_note_limit" },
      });
      const [{ total }] = (
        await client.query(
          "SELECT count(*)::int AS total FROM analytics_data_notes",
        )
      ).rows;
      expect(total).toBe(store.MAX_DATA_NOTES);
    });

    it("locks the scope in every write's transaction", async () => {
      const added = await store.saveDataNote(alice, incident);
      await store.saveDataNote(bob, { id: added.id, title: "Setup failures" });
      await store.deleteDataNote(alice, added.id);
      const writes = queries.filter(
        ({ query }) => !/^s*(begin|commit)/i.test(query),
      );
      expect(
        writes.flatMap(({ query, params }, index) =>
          query.includes("pg_advisory_xact_lock")
            ? [{ key: params[0], next: writes[index + 1]?.query.split(" ")[0] }]
            : [],
        ),
      ).toEqual([
        { key: "org:org-1", next: "select" },
        { key: "org:org-1", next: "select" },
        { key: "org:org-1", next: "delete" },
      ]);
    });

    it("takes one advisory lock per organization, or per user without one, until commit", async () => {
      const heldLocks = (scope: typeof alice | typeof alicePersonal) =>
        getDbMock().transaction(async (tx: any) => {
          await lockAnnotationScope(tx, scope);
          const { rows } = await tx.execute(
            sql`SELECT objid::text AS objid FROM pg_locks WHERE locktype = 'advisory'`,
          );
          return rows.map((row: { objid: string }) => row.objid);
        });
      const lockFor = async (key: string) =>
        (
          await client.query(
            "SELECT (hashtext($1)::bigint & 4294967295)::text AS objid",
            [key],
          )
        ).rows[0].objid;

      expect(await heldLocks(bob)).toEqual([
        await lockFor("analytics-annotations:org:org-1"),
      ]);
      expect(
        await heldLocks({ email: "Alice@Example.test", orgId: null }),
      ).toEqual([
        await lockFor("analytics-annotations:user:alice@example.test"),
      ]);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS total FROM pg_locks WHERE locktype = 'advisory'",
          )
        ).rows[0].total,
      ).toBe(0);
    });
  });
});
