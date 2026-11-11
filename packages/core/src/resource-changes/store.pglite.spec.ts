import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real PGlite behind getDbExec: the feed's tables, its capture triggers, and
// the claim and enqueue statements run as they do in production.

type Client = typeof import("../db/client.js");
type Feed = typeof import("./store.js");

let client: Client;
let feed: Feed;

const source = {
  app: "notes",
  resourceType: "note",
  table: "notes",
  idColumn: "id",
};
const notes = { consumer: "notes-index", app: "notes", resourceType: "note" };
const other = { consumer: "notes-mirror", app: "notes", resourceType: "note" };

const exec = () => client.getDbExec();

async function run(sql: string, args: unknown[] = []) {
  // raw-sql-ok: tests pass fixed SQL and bind their values.
  return exec().execute({ sql, args });
}

/** Ages every queued change by `seconds`, as a pause in edits would. */
async function age(seconds: number) {
  await run(
    `UPDATE app_resource_changes SET changed_at = changed_at - make_interval(secs => ?)`,
    [seconds],
  );
}

async function queued(consumer: string) {
  const { rows } = await run(
    `SELECT resource_id, reason, seq::text AS seq, attempts, failed_at,
            available_at <= clock_timestamp() AS available,
            changed_at > clock_timestamp() - interval '10 seconds' AS recent
     FROM app_resource_changes WHERE consumer = ? ORDER BY resource_id`,
    [consumer],
  );
  return rows.map((row) => ({
    id: String(row.resource_id),
    reason: String(row.reason),
    seq: String(row.seq),
    attempts: Number(row.attempts),
    failed: row.failed_at !== null,
    available: Boolean(row.available),
    recent: Boolean(row.recent),
  }));
}

async function claimedIds(options?: { settledSeconds?: number }) {
  const claimed = await feed.claimResourceChanges(
    exec(),
    notes,
    10,
    undefined,
    options,
  );
  return claimed.map((change) => change.resourceId).sort();
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  client = await import("../db/client.js");
  feed = await import("./store.js");
  await run(`CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)`);
  for (const consumer of [notes.consumer, other.consumer]) {
    expect(
      await feed.installResourceChangeCapture(exec(), source, consumer),
    ).toBe(true);
  }
});

beforeEach(async () => {
  await run(`DELETE FROM notes`);
  await run(`DELETE FROM app_resource_changes`);
});

describe("claimResourceChanges with a settle time", () => {
  it("leaves a change unclaimed until it has settled", async () => {
    await run(`INSERT INTO notes (id, body) VALUES ('n1', 'Draft')`);
    expect(await claimedIds({ settledSeconds: 60 })).toEqual([]);
    await age(30);
    expect(await claimedIds({ settledSeconds: 60 })).toEqual([]);
    await age(31);
    expect(await claimedIds({ settledSeconds: 60 })).toEqual(["n1"]);
  });

  it("claims only the changes that have settled", async () => {
    await run(`INSERT INTO notes (id, body) VALUES ('old', 'Quiet')`);
    await age(120);
    await run(`INSERT INTO notes (id, body) VALUES ('new', 'Busy')`);
    expect(await claimedIds({ settledSeconds: 60 })).toEqual(["old"]);
  });

  it("starts the wait again when the resource changes again", async () => {
    await run(`INSERT INTO notes (id, body) VALUES ('n1', 'Draft')`);
    await age(120);
    await run(`UPDATE notes SET body = 'Edited' WHERE id = 'n1'`);
    expect(await claimedIds({ settledSeconds: 60 })).toEqual([]);
  });

  it("claims at once without a settle time or with zero", async () => {
    await run(`INSERT INTO notes (id, body) VALUES ('n1', 'Draft')`);
    expect(await claimedIds({ settledSeconds: 0 })).toEqual(["n1"]);
    await run(`INSERT INTO notes (id, body) VALUES ('n2', 'Draft')`);
    expect(await claimedIds()).toEqual(["n2"]);
  });

  it("refuses a negative or non-finite settle time", async () => {
    for (const settledSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(claimedIds({ settledSeconds })).rejects.toThrow(
        "settledSeconds must be a non-negative number.",
      );
    }
  });
});

describe("enqueueSelectedResourceChanges", () => {
  const select = (...ids: string[]) => ({
    sql: `SELECT id AS resource_id FROM notes WHERE id IN (${ids.map(() => "?").join(", ")})`,
    args: ids,
  });

  it("queues one change for each selected resource, for that consumer only", async () => {
    await run(
      `INSERT INTO notes (id, body) VALUES ('a', 'A'), ('b', 'B'), ('c', 'C')`,
    );
    await run(`DELETE FROM app_resource_changes`);
    await feed.enqueueSelectedResourceChanges(
      exec(),
      notes,
      select("a", "c"),
      "requeue",
    );
    const rows = await queued(notes.consumer);
    expect(
      rows.map(({ id, reason, attempts, failed, available }) => ({
        id,
        reason,
        attempts,
        failed,
        available,
      })),
    ).toEqual([
      {
        id: "a",
        reason: "requeue",
        attempts: 0,
        failed: false,
        available: true,
      },
      {
        id: "c",
        reason: "requeue",
        attempts: 0,
        failed: false,
        available: true,
      },
    ]);
    expect(rows[0]?.seq).not.toBe(rows[1]?.seq);
    expect(await queued(other.consumer)).toEqual([]);
    const { rows: scoped } = await run(
      `SELECT DISTINCT app, resource_type FROM app_resource_changes`,
    );
    expect(scoped).toEqual([{ app: "notes", resource_type: "note" }]);
  });

  it("replaces a change already queued, so it is claimable and settles again", async () => {
    await run(`INSERT INTO notes (id, body) VALUES ('a', 'A')`);
    await run(
      `UPDATE app_resource_changes
       SET reason = 'old', attempts = 5, failed_at = now(),
           available_at = clock_timestamp() + interval '1 hour',
           changed_at = changed_at - interval '1 hour'`,
    );
    const [before] = await queued(notes.consumer);
    await feed.enqueueSelectedResourceChanges(
      exec(),
      notes,
      select("a"),
      "repair",
    );
    const [after] = await queued(notes.consumer);
    expect(after).toMatchObject({
      id: "a",
      reason: "repair",
      attempts: 0,
      failed: false,
      available: true,
      recent: true,
    });
    expect(BigInt(after?.seq ?? 0)).toBeGreaterThan(BigInt(before?.seq ?? 0));
    expect(await claimedIds({ settledSeconds: 60 })).toEqual([]);
    expect(await claimedIds()).toEqual(["a"]);
    const [mirror] = await queued(other.consumer);
    expect(mirror).toMatchObject({ reason: "old", attempts: 5, failed: true });
  });

  it("binds the selection's values", async () => {
    await run(`INSERT INTO notes (id, body) VALUES ('a', 'A'), ('b', 'B')`);
    await run(`DELETE FROM app_resource_changes`);
    await feed.enqueueSelectedResourceChanges(
      exec(),
      notes,
      { sql: "SELECT CAST(? AS TEXT) AS resource_id", args: ["b"] },
      "semantic-repair",
    );
    expect((await queued(notes.consumer)).map((row) => row.id)).toEqual(["b"]);
  });
});
