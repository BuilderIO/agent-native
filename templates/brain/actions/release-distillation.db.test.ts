import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import * as schema from "../server/db/schema.js";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  access: vi.fn(),
  editor: vi.fn(),
  statements: [] as string[],
}));
vi.mock("../server/db/index.js", async () => ({
  schema: await import("../server/db/schema.js"),
  getDb: () => state.db,
}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: async ({ sql, args }: { sql: string; args: unknown[] }) => {
      const result = await db.query(sql, args);
      return { rowsAffected: result.affectedRows };
    },
  }),
}));
vi.mock("../server/lib/search.js", () => ({
  redactSensitiveText: (value: unknown) => value,
  redactSensitiveValue: (value: unknown) => value,
}));
vi.mock("@agent-native/core/sharing", () => ({ assertAccess: state.editor }));
vi.mock("../server/lib/brain.js", () => ({
  getAccessibleCapture: state.access,
  serializeCapture: (capture: unknown) => capture,
  nowIso: () => "2026-01-01T00:00:00.000Z",
  nanoid: () => "claim-token",
  parseJson: (value: string | null, fallback: unknown) =>
    value ? JSON.parse(value) : fallback,
  stableJson: JSON.stringify,
  serializeDistillationQueue: (value: unknown) => value,
}));
import claim from "./claim-distillation.js";
import complete from "./mark-capture-distilled.js";
import release from "./release-distillation.js";

const db = new PGlite();
beforeAll(async () => {
  state.db = drizzle(db, {
    schema,
    logger: { logQuery: (query) => state.statements.push(query) },
  });
  await db.exec(`CREATE TABLE brain_ingest_queue (
    id text primary key, capture_id text, operation text, status text,
    lease_token text, lease_expires_at text, error text, updated_at text,
    source_id text, priority integer, attempts integer, payload_json text, dedupe_key text, run_after text, created_at text
  ); CREATE TABLE brain_raw_captures (id text primary key, status text, distilled_at text, updated_at text)`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  state.access
    .mockReset()
    .mockResolvedValue({ capture: { id: "capture", sourceId: "source" } });
  state.editor.mockReset().mockResolvedValue(undefined);
  await db.exec(`TRUNCATE brain_ingest_queue, brain_raw_captures;
    INSERT INTO brain_raw_captures VALUES ('capture','distilling',null,'before');
    INSERT INTO brain_ingest_queue (id,capture_id,operation,status,lease_token,lease_expires_at,error,updated_at) VALUES
      ('queue', 'capture', 'distill', 'processing', 'active', 'later', NULL, 'before')`);
});
const args = {
  captureId: "capture",
  queueId: "queue",
  claimToken: "active",
  reason: "delivery-unknown" as const,
};
async function row() {
  return (
    await db.query<{
      status: string;
      lease_token: string | null;
      error: string | null;
    }>(
      "SELECT status, lease_token, error FROM brain_ingest_queue WHERE id = 'queue'",
    )
  ).rows[0];
}

it("records an uncertain handoff as failed, not processing", async () => {
  await expect(release.run(args)).resolves.toEqual({ released: true });
  expect(await row()).toEqual({
    status: "failed",
    lease_token: null,
    error: expect.stringContaining("Check for partial work"),
  });
});
it("does not release a newer worker's claim", async () => {
  await expect(release.run({ ...args, claimToken: "stale" })).resolves.toEqual({
    released: false,
  });
  expect(await row()).toEqual({
    status: "processing",
    lease_token: "active",
    error: null,
  });
});
it("does not release an inaccessible capture", async () => {
  state.access.mockResolvedValue(null);
  await expect(release.run(args)).rejects.toThrow("No access to capture");
  expect(await row()).toEqual({
    status: "processing",
    lease_token: "active",
    error: null,
  });
});
it("does not release a different operation", async () => {
  await db.exec("UPDATE brain_ingest_queue SET operation = 'sync'");
  await expect(release.run(args)).resolves.toEqual({ released: false });
  expect(await row()).toEqual({
    status: "processing",
    lease_token: "active",
    error: null,
  });
});

it("denies viewers without changing the claim", async () => {
  state.editor.mockRejectedValue(new Error("editor required"));
  await expect(release.run(args)).rejects.toThrow("editor required");
  expect(await row()).toEqual({
    status: "processing",
    lease_token: "active",
    error: null,
  });
});

it("denies viewers before claiming queued work", async () => {
  await db.exec(
    "UPDATE brain_ingest_queue SET status = 'queued', lease_token = NULL",
  );
  state.editor.mockRejectedValue(new Error("editor required"));
  await expect(
    claim.run({ captureId: "capture", queueId: "queue" }),
  ).rejects.toThrow("editor required");
  expect(await row()).toEqual({
    status: "queued",
    lease_token: null,
    error: null,
  });
});

it.each(["distilled", "ignored"] as const)(
  "denies viewer completion as %s without changing state",
  async (status) => {
    await db.exec(
      "UPDATE brain_ingest_queue SET status='queued', lease_token=NULL",
    );
    state.editor.mockRejectedValue(new Error("editor required"));
    await expect(
      complete.run({ captureId: "capture", status }),
    ).rejects.toThrow("editor required");
    expect(await row()).toEqual({
      status: "queued",
      lease_token: null,
      error: null,
    });
    expect(
      (
        await db.query(
          "SELECT status,distilled_at,updated_at FROM brain_raw_captures",
        )
      ).rows[0],
    ).toEqual({
      status: "distilling",
      distilled_at: null,
      updated_at: "before",
    });
  },
);
it("denies a downgraded claimant completion without changing state", async () => {
  state.editor.mockRejectedValue(new Error("editor required"));
  await expect(
    complete.run({
      captureId: "capture",
      status: "distilled",
      queueId: "queue",
      claimToken: "active",
    }),
  ).rejects.toThrow("editor required");
  expect(await row()).toEqual({
    status: "processing",
    lease_token: "active",
    error: null,
  });
  expect(
    (
      await db.query(
        "SELECT status,distilled_at,updated_at FROM brain_raw_captures",
      )
    ).rows[0],
  ).toEqual({ status: "distilling", distilled_at: null, updated_at: "before" });
});

it("requeues an unreadable claim without losing its request or changing newer claims", async () => {
  await expect(
    release.run({ ...args, reason: "read-unavailable" }),
  ).resolves.toEqual({ released: true });
  expect(await row()).toEqual({
    status: "queued",
    lease_token: null,
    error: null,
  });
  await db.exec(
    "UPDATE brain_ingest_queue SET status='processing',lease_token='new-worker'",
  );
  await expect(
    release.run({ ...args, reason: "read-unavailable" }),
  ).resolves.toEqual({ released: false });
  expect(await row()).toEqual({
    status: "processing",
    lease_token: "new-worker",
    error: null,
  });
});

it("keeps an unreadable claim ineligible until its durable delay elapses", async () => {
  await expect(
    release.run({ ...args, reason: "read-unavailable" }),
  ).resolves.toEqual({ released: true });
  expect(
    (await db.query("SELECT run_after FROM brain_ingest_queue")).rows,
  ).toEqual([{ run_after: "2026-01-01T00:00:10.000Z" }]);
  await expect(
    claim.run({ captureId: "capture", queueId: "queue" }),
  ).resolves.toMatchObject({ claimed: false });
  expect(await row()).toEqual({
    status: "queued",
    lease_token: null,
    error: null,
  });
  await db.exec(
    "UPDATE brain_ingest_queue SET run_after='2025-12-31T23:59:59.000Z'",
  );
  await expect(
    claim.run({ captureId: "capture", queueId: "queue" }),
  ).resolves.toMatchObject({ claimed: true, claimToken: "claim-token" });
  await db.exec(
    "UPDATE brain_ingest_queue SET status='queued', lease_token=NULL, run_after=NULL",
  );
  await expect(
    claim.run({ captureId: "capture", queueId: "queue" }),
  ).resolves.toMatchObject({ claimed: true });
});

const captureRow = async () =>
  (
    await db.query(
      "SELECT status,distilled_at,updated_at FROM brain_raw_captures",
    )
  ).rows[0];

it.each(["claimed", "unclaimed"] as const)(
  "rolls back %s completion when the capture update fails",
  async (mode) => {
    if (mode === "unclaimed") {
      await db.exec(
        "UPDATE brain_ingest_queue SET status='queued', lease_token=NULL",
      );
    }
    await db.exec(`CREATE FUNCTION reject_capture_update() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'capture update rejected'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_capture BEFORE UPDATE ON brain_raw_captures
      FOR EACH ROW EXECUTE FUNCTION reject_capture_update()`);
    try {
      await expect(
        complete.run(
          mode === "claimed"
            ? {
                captureId: "capture",
                status: "distilled",
                queueId: "queue",
                claimToken: "active",
              }
            : { captureId: "capture", status: "distilled" },
        ),
      ).rejects.toThrow();
    } finally {
      await db.exec(
        "DROP TRIGGER reject_capture ON brain_raw_captures; DROP FUNCTION reject_capture_update()",
      );
    }
    expect(await row()).toEqual(
      mode === "claimed"
        ? { status: "processing", lease_token: "active", error: null }
        : { status: "queued", lease_token: null, error: null },
    );
    expect(await captureRow()).toEqual({
      status: "distilling",
      distilled_at: null,
      updated_at: "before",
    });
  },
);

it("completes a valid claim and its capture together", async () => {
  await expect(
    complete.run({
      captureId: "capture",
      status: "distilled",
      queueId: "queue",
      claimToken: "active",
    }),
  ).resolves.toMatchObject({ capture: expect.anything() });
  expect(await row()).toEqual({
    status: "done",
    lease_token: null,
    error: null,
  });
  expect(await captureRow()).toMatchObject({ status: "distilled" });
});

it("refuses unclaimed completion when a claim appears while it runs", async () => {
  await db.exec(
    "UPDATE brain_ingest_queue SET status='queued', lease_token=NULL",
  );
  await db.exec(`CREATE FUNCTION racing_claim() RETURNS trigger AS $$
    BEGIN
      INSERT INTO brain_ingest_queue (id,capture_id,operation,status,lease_token,updated_at)
      VALUES ('racer','capture','distill','processing','racer-token','before');
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER racing_claim BEFORE UPDATE ON brain_ingest_queue
    FOR EACH ROW WHEN (OLD.status='queued' AND NEW.status='done')
    EXECUTE FUNCTION racing_claim()`);
  try {
    await expect(
      complete.run({ captureId: "capture", status: "distilled" }),
    ).rejects.toThrow("active distillation claim");
  } finally {
    await db.exec(
      "DROP TRIGGER racing_claim ON brain_ingest_queue; DROP FUNCTION racing_claim()",
    );
  }
  expect(
    (await db.query("SELECT id,status FROM brain_ingest_queue ORDER BY id"))
      .rows,
  ).toEqual([{ id: "queue", status: "queued" }]);
  expect(await captureRow()).toEqual({
    status: "distilling",
    distilled_at: null,
    updated_at: "before",
  });
});

it.each(["release", "completion"] as const)(
  "%s locks the capture row before writing the queue row",
  async (mode) => {
    state.statements.length = 0;
    if (mode === "release") {
      await release.run({ ...args, reason: "read-unavailable" });
    } else {
      await complete.run({
        captureId: "capture",
        status: "distilled",
        queueId: "queue",
        claimToken: "active",
      });
    }
    const lock = state.statements.findIndex((query) =>
      /from "brain_raw_captures".* for update/s.test(query),
    );
    const write = state.statements.findIndex((query) =>
      query.startsWith('update "brain_ingest_queue"'),
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThan(lock);
  },
);
