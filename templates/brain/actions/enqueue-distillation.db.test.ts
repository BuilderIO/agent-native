import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import * as schema from "../server/db/schema.js";
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  editor: vi.fn(),
  nanoid: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({ getDb: () => state.db, schema }));
vi.mock("@agent-native/core/sharing", () => ({ assertAccess: state.editor }));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: state.write,
}));
vi.mock("../server/lib/brain.js", () => ({
  getAccessibleCapture: async () => ({
    capture: {
      id: "capture",
      sourceId: "source",
      title: "Synthetic transcript",
      content: "Synthetic content",
      status: "pending",
    },
  }),
  nowIso: () => "2026-01-01T01:00:00.000Z",
  nanoid: () => state.nanoid(),
  readBrainAgentGuidance: async () => ({
    guidance: { identity: {}, distillation: {} },
  }),
  parseJson: JSON.parse,
  stableJson: JSON.stringify,
  serializeDistillationQueue: (x: unknown) => x,
}));
vi.mock("../server/lib/search.js", () => ({
  redactSensitiveText: (x: unknown) => x,
}));
import batch from "./enqueue-captures-distillation.js";
import single from "./enqueue-distillation.js";
const db = new PGlite();
beforeAll(async () => {
  state.db = drizzle(db, { schema });
  await db.exec(`CREATE TABLE brain_ingest_queue (
 id text primary key, source_id text, capture_id text, operation text, status text,
 priority integer, attempts integer, payload_json text, dedupe_key text, lease_token text,
 lease_expires_at text, error text, run_after text, created_at text, updated_at text);
 CREATE TABLE brain_raw_captures (id text primary key,status text,distilled_at text,updated_at text,source_id text);`);
});
afterAll(async () => db.close());
beforeEach(async () => {
  state.editor.mockReset().mockRejectedValue(new Error("editor required"));
  state.write.mockReset().mockResolvedValue(undefined);
  state.nanoid.mockReset().mockReturnValue("queue");
  await db.exec(`TRUNCATE brain_ingest_queue,brain_raw_captures;
 INSERT INTO brain_raw_captures VALUES ('capture','pending',null,'before','source');`);
});
it.each(["single", "batch"])(
  "viewer cannot enqueue through %s action or publish a request",
  async (mode) => {
    let result: unknown;
    try {
      result =
        mode === "single"
          ? await single.run({
              captureId: "capture",
              priority: 50,
              reconsiderIgnored: false,
            })
          : await batch.run({ captureIds: ["capture"], priority: 50 });
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const capture = (
      await db.query("SELECT status,updated_at FROM brain_raw_captures")
    ).rows;
    const queue = (await db.query("SELECT id FROM brain_ingest_queue")).rows;
    expect(result).toMatchObject(
      mode === "single"
        ? { error: "editor required" }
        : {
            queued: 0,
            errors: 1,
            results: [{ outcome: "error", error: "editor required" }],
          },
    );
    expect({
      capture,
      queue,
      writes: state.write.mock.calls.length,
      result,
    }).toMatchObject({
      capture: [{ status: "pending", updated_at: "before" }],
      queue: [],
      writes: 0,
    });
  },
);

it.each(["single", "batch"])(
  "editor can enqueue through %s action",
  async (mode) => {
    state.editor.mockResolvedValue(undefined);
    const result =
      mode === "single"
        ? await single.run({
            captureId: "capture",
            priority: 50,
            reconsiderIgnored: false,
          })
        : await batch.run({ captureIds: ["capture"], priority: 50 });
    expect(result).toMatchObject(
      mode === "single" ? { existing: false } : { queued: 1, errors: 0 },
    );
    expect(
      (await db.query("SELECT status FROM brain_raw_captures")).rows,
    ).toEqual([{ status: "distilling" }]);
    expect((await db.query("SELECT id FROM brain_ingest_queue")).rows).toEqual([
      { id: "queue" },
    ]);
    expect(state.write).toHaveBeenCalledOnce();
  },
);

it("leaves no queued row without a request when request publication fails", async () => {
  state.editor.mockResolvedValue(undefined);
  state.write.mockRejectedValueOnce(new Error("interrupted"));
  await expect(
    single.run({
      captureId: "capture",
      priority: 50,
      reconsiderIgnored: false,
    }),
  ).rejects.toThrow("interrupted");
  expect(
    (await db.query("SELECT status,updated_at FROM brain_raw_captures")).rows,
  ).toEqual([{ status: "pending", updated_at: "before" }]);
  expect((await db.query("SELECT id FROM brain_ingest_queue")).rows).toEqual(
    [],
  );
});

const singleArgs = {
  captureId: "capture",
  priority: 50,
  reconsiderIgnored: false,
};

it("serializes concurrent initial enqueues into one active queue row", async () => {
  state.editor.mockResolvedValue(undefined);
  let next = 0;
  state.nanoid.mockImplementation(() => `queue-${++next}`);
  const results = await Promise.all([
    single.run(singleArgs),
    single.run(singleArgs),
  ]);
  expect(
    results.map((result) => (result as { existing: boolean }).existing).sort(),
  ).toEqual([false, true]);
  expect((await db.query("SELECT id FROM brain_ingest_queue")).rows).toEqual([
    { id: "queue-1" },
  ]);
});

it("refuses a capture that became ignored after the action read it", async () => {
  state.editor.mockResolvedValue(undefined);
  await db.exec("UPDATE brain_raw_captures SET status='ignored'");
  await expect(single.run(singleArgs)).rejects.toThrow("already ignored");
  expect(
    (await db.query("SELECT status,updated_at FROM brain_raw_captures")).rows,
  ).toEqual([{ status: "ignored", updated_at: "before" }]);
  expect((await db.query("SELECT id FROM brain_ingest_queue")).rows).toEqual(
    [],
  );
  expect(state.write).not.toHaveBeenCalled();
  await expect(
    single.run({ ...singleArgs, reconsiderIgnored: true }),
  ).resolves.toMatchObject({ existing: false });
  expect(
    (await db.query("SELECT status FROM brain_raw_captures")).rows,
  ).toEqual([{ status: "distilling" }]);
});

it("keeps reuse of an existing queued row and its request in one failure boundary", async () => {
  state.editor.mockResolvedValue(undefined);
  await db.exec(
    "INSERT INTO brain_ingest_queue (id,source_id,capture_id,operation,status,payload_json,updated_at) VALUES ('existing','source','capture','distill','queued','{}','before')",
  );
  state.write.mockRejectedValueOnce(new Error("interrupted"));
  await expect(single.run(singleArgs)).rejects.toThrow("interrupted");
  expect(
    (await db.query("SELECT status,updated_at FROM brain_raw_captures")).rows,
  ).toEqual([{ status: "pending", updated_at: "before" }]);
  await expect(single.run(singleArgs)).resolves.toMatchObject({
    existing: true,
  });
  expect(
    (await db.query("SELECT status FROM brain_raw_captures")).rows,
  ).toEqual([{ status: "distilling" }]);
});
