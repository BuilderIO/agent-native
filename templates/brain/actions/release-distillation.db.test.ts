import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import * as schema from "../server/db/schema.js";

const state = vi.hoisted(() => ({ db: undefined as unknown, access: vi.fn() }));
vi.mock("../server/db/index.js", async () => ({
  schema: await import("../server/db/schema.js"),
  getDb: () => state.db,
}));
vi.mock("../server/lib/brain.js", () => ({
  getAccessibleCapture: state.access,
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));
import release from "./release-distillation.js";

const db = new PGlite();
beforeAll(async () => {
  state.db = drizzle(db, { schema });
  await db.exec(`CREATE TABLE brain_ingest_queue (
    id text primary key, capture_id text, operation text, status text,
    lease_token text, lease_expires_at text, error text, updated_at text
  )`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  state.access.mockReset().mockResolvedValue({ capture: { id: "capture" } });
  await db.exec(`TRUNCATE brain_ingest_queue;
    INSERT INTO brain_ingest_queue VALUES
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
