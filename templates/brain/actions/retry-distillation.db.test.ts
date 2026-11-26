import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import * as schema from "../server/db/schema.js";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  access: vi.fn(),
  request: vi.fn(),
}));
vi.mock("../server/db/index.js", async () => ({
  schema: await import("../server/db/schema.js"),
  getDb: () => state.db,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: state.request,
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(),
  assertAccess: state.access,
}));
vi.mock("../server/lib/brain.js", () => ({
  getAccessibleCapture: async () => ({
    capture: { id: "capture", sourceId: "source", title: "Synthetic meeting" },
  }),
  nanoid: () => crypto.randomUUID(),
  nowIso: () => "2026-01-01T01:00:00.000Z",
  parseJson: JSON.parse,
  stableJson: JSON.stringify,
  serializeDistillationQueue: (value: unknown) => value,
  readBrainAgentGuidance: async () => ({
    guidance: { identity: {}, distillation: {} },
  }),
}));
vi.mock("../server/lib/search.js", () => ({
  redactSensitiveText: (value: string) => value,
}));
vi.mock("../server/lib/source-access.js", () => ({
  personalGoogleSourceFilter: vi.fn(),
}));
import retry from "./retry-distillation.js";

const db = new PGlite();
const originalTime = "2026-01-01T00:00:00.000Z";
const newerTime = "2026-01-01T00:59:00.000Z";
const retryTime = "2026-01-01T01:00:00.000Z";
beforeAll(async () => {
  state.db = drizzle(db, { schema });
  await db.exec(`CREATE TABLE brain_ingest_queue (
    id text primary key, source_id text, capture_id text, operation text, status text,
    priority integer, attempts integer, payload_json text, dedupe_key text, lease_token text,
    lease_expires_at text, error text, run_after text, created_at text, updated_at text);
    CREATE TABLE brain_raw_captures (id text primary key, status text, distilled_at text, updated_at text, source_id text);
    CREATE TABLE brain_sources (id text primary key);
    INSERT INTO brain_sources VALUES ('source');`);
});
afterAll(async () => db.close());
beforeEach(async () => {
  state.access.mockReset().mockResolvedValue(undefined);
  state.request.mockReset().mockResolvedValue(undefined);
  await db.exec(`TRUNCATE brain_ingest_queue,brain_raw_captures;
    INSERT INTO brain_ingest_queue VALUES
    ('queue','source','capture','distill','processing',50,1,'{}',null,'old','2026-01-01T00:15:00.000Z',null,null,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO brain_raw_captures VALUES ('capture','distilling',null,'2026-01-01T00:00:00.000Z','source');`);
});
const run = () =>
  retry.run({ queueId: "queue", retryAllRetryable: false, limit: 100 });
async function queue() {
  return (
    await db.query(
      "SELECT status,lease_token,lease_expires_at,updated_at FROM brain_ingest_queue",
    )
  ).rows[0];
}

it.each(["done", "processing", "lease-only"] as const)(
  "report BRAIN-DISTILL-001 retry preserves concurrent %s after its stale read",
  async (race) => {
    const status = race === "done" ? "done" : "processing";
    const timestamp = race === "lease-only" ? originalTime : newerTime;
    const lease = race === "done" ? null : "new-worker";
    state.access.mockImplementation(async () => {
      await db.query(
        "UPDATE brain_ingest_queue SET status=$1,lease_token=$2,updated_at=$3 WHERE id=$4",
        [status, lease, timestamp, "queue"],
      );
      if (race === "done")
        await db.query(
          "UPDATE brain_raw_captures SET status='distilled',distilled_at=$1",
          [newerTime],
        );
    });
    await expect(run()).rejects.toMatchObject({
      errorCode: "distillation_retry_conflict",
    });
    expect(await queue()).toMatchObject({
      status,
      lease_token: lease,
      updated_at: timestamp,
    });
    expect(
      (await db.query("SELECT status,distilled_at FROM brain_raw_captures"))
        .rows[0],
    ).toEqual({
      status: race === "done" ? "distilled" : "distilling",
      distilled_at: race === "done" ? newerTime : null,
    });
    expect(state.request).not.toHaveBeenCalled();
  },
);
it("report BRAIN-DISTILL-001 stale retry clears its old lease and writes a new request", async () => {
  await expect(run()).resolves.toMatchObject({
    retried: true,
    staleProcessing: true,
  });
  expect(await queue()).toEqual({
    status: "queued",
    lease_token: null,
    lease_expires_at: null,
    updated_at: retryTime,
  });
  expect(state.request).toHaveBeenCalledOnce();
  expect(state.request).toHaveBeenCalledWith(
    "brain-distill-request-capture",
    expect.objectContaining({
      captureId: "capture",
      queueId: "queue",
      requestedAt: retryTime,
    }),
  );
});
it("report BRAIN-DISTILL-001 queue retry rolls back when its capture update fails", async () => {
  await db.exec(
    "UPDATE brain_ingest_queue SET status='failed'; ALTER TABLE brain_raw_captures ADD CONSTRAINT reject_retry CHECK(updated_at <> '2026-01-01T01:00:00.000Z')",
  );
  try {
    await expect(run()).rejects.toThrow();
    expect(await queue()).toMatchObject({
      status: "failed",
      lease_token: "old",
      updated_at: originalTime,
    });
    expect(state.request).not.toHaveBeenCalled();
  } finally {
    await db.exec(
      "ALTER TABLE brain_raw_captures DROP CONSTRAINT reject_retry",
    );
  }
});

it("report BRAIN-DISTILL-001 retry-all retains lease fields needed for conditional recovery", async () => {
  await expect(
    retry.run({ retryAllRetryable: true, limit: 100 }),
  ).resolves.toMatchObject({ retriedCount: 1, errorCount: 0 });
  expect(await queue()).toEqual({
    status: "queued",
    lease_token: null,
    lease_expires_at: null,
    updated_at: retryTime,
  });
  expect(state.request).toHaveBeenCalledOnce();
});

it("keeps a failed request delivery retryable", async () => {
  state.request.mockRejectedValueOnce(new Error("request write failed"));
  await expect(run()).rejects.toThrow("request write failed");
  expect(await queue()).toMatchObject({
    status: "processing",
    lease_token: "old",
    updated_at: originalTime,
  });
  await expect(run()).resolves.toMatchObject({ retried: true });
});

it("does not undo a newer claim when request delivery fails", async () => {
  let worker: Promise<unknown> = Promise.resolve();
  state.request.mockImplementationOnce(async () => {
    worker = db.query(
      "UPDATE brain_ingest_queue SET status='processing', lease_token='new-worker', updated_at=$1 WHERE id='queue'",
      [newerTime],
    );
    throw new Error("response lost");
  });
  await expect(run()).rejects.toThrow("response lost");
  await worker;
  expect(await queue()).toMatchObject({
    status: "processing",
    lease_token: "new-worker",
    updated_at: newerTime,
  });
});

it("recovers when the request was stored but its response was lost", async () => {
  let stored: unknown;
  state.request
    .mockImplementationOnce(async (_key, value) => {
      stored = value;
      throw new Error("response lost");
    })
    .mockImplementationOnce(async (_key, value) => {
      stored = value;
    });
  await expect(run()).rejects.toThrow("response lost");
  expect(stored).toMatchObject({ queueId: "queue" });
  expect(await queue()).toMatchObject({
    status: "processing",
    lease_token: "old",
    updated_at: originalTime,
  });
  await expect(run()).resolves.toMatchObject({ retried: true });
  expect(await queue()).toMatchObject({ status: "queued", lease_token: null });
  expect(stored).toMatchObject({ queueId: "queue" });
});

it("rolls back the queued retry when request publication is interrupted", async () => {
  state.request.mockRejectedValueOnce(new Error("interrupted"));
  await expect(run()).rejects.toThrow("interrupted");
  expect(await queue()).toMatchObject({
    status: "processing",
    lease_token: "old",
    updated_at: originalTime,
  });
});

it("retries one row per capture and leaves a single queued item with its request", async () => {
  await db.exec("UPDATE brain_ingest_queue SET status='failed'");
  await db.exec(
    "INSERT INTO brain_ingest_queue VALUES ('newer','source','capture','distill','failed',50,1,'{}',null,null,null,'boom',null,'2026-01-01T00:20:00.000Z','2026-01-01T00:30:00.000Z')",
  );
  await expect(
    retry.run({ retryAllRetryable: true, limit: 100 }),
  ).resolves.toMatchObject({ retriedCount: 1, errorCount: 1 });
  expect(
    (await db.query("SELECT id,status FROM brain_ingest_queue ORDER BY id"))
      .rows,
  ).toEqual([
    { id: "newer", status: "queued" },
    { id: "queue", status: "failed" },
  ]);
  expect(state.request).toHaveBeenCalledOnce();
  expect(state.request).toHaveBeenCalledWith(
    "brain-distill-request-capture",
    expect.objectContaining({ queueId: "newer" }),
  );
});

it("refuses to retry another row while a stale claim for the capture could still complete", async () => {
  await db.exec(
    "INSERT INTO brain_ingest_queue VALUES ('newer','source','capture','distill','failed',50,1,'{}',null,null,null,'boom',null,'2026-01-01T00:20:00.000Z','2026-01-01T00:30:00.000Z')",
  );
  await expect(
    retry.run({ queueId: "newer", retryAllRetryable: false, limit: 100 }),
  ).rejects.toMatchObject({ errorCode: "distillation_retry_conflict" });
  expect(
    (
      await db.query(
        "SELECT id,status,lease_token FROM brain_ingest_queue ORDER BY id",
      )
    ).rows,
  ).toEqual([
    { id: "newer", status: "failed", lease_token: null },
    { id: "queue", status: "processing", lease_token: "old" },
  ]);
  expect(state.request).not.toHaveBeenCalled();
});

it.each(["distilled", "ignored"] as const)(
  "refuses to requeue a %s capture",
  async (status) => {
    await db.exec(
      `UPDATE brain_ingest_queue SET status='failed'; UPDATE brain_raw_captures SET status='${status}'`,
    );
    await expect(run()).rejects.toMatchObject({
      errorCode: "distillation_retry_conflict",
    });
    expect(await queue()).toMatchObject({ status: "failed" });
    expect(
      (await db.query("SELECT status FROM brain_raw_captures")).rows,
    ).toEqual([{ status }]);
    expect(state.request).not.toHaveBeenCalled();
  },
);
