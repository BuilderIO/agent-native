import { createRequire } from "node:module";

import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
let client: Awaited<ReturnType<typeof PGlite.create>>;
let db: ReturnType<typeof drizzle>;
const access = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: access.resolve,
}));
vi.mock("../server/db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../server/db/schema.js"),
}));
import { meetings } from "../server/db/schema";
import action from "./get-meeting-capture-state";

beforeAll(async () => {
  client = await PGlite.create("memory://");
  db = drizzle(client);
  const columns = Object.values(getTableColumns(meetings)).map(
    (column) => `"${column.name}" ${column.getSQLType()}`,
  );
  await client.exec(`CREATE TABLE clips_meetings (${columns.join(", ")})`);
  await db.insert(meetings).values([
    {
      id: "trashed",
      ownerEmail: "owner@example.com",
      title: "Private title",
      actualEnd: "2026-10-21T17:00:00Z",
      captureStopRevision: 3,
      trashedAt: "2026-10-21T17:01:00Z",
    },
    {
      id: "active",
      ownerEmail: "owner@example.com",
      title: "Active",
      actualEnd: null,
      captureStopRevision: 0,
    },
  ]);
});
afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  access.resolve.mockReset().mockResolvedValue({ role: "owner" });
});
it("returns a trashed meeting closure without loading related content", async () => {
  expect(await action.run({ id: "trashed" })).toEqual({
    meeting: { actualEnd: "2026-10-21T17:00:00Z", captureStopRevision: 3 },
  });
  expect(access.resolve).toHaveBeenCalledExactlyOnceWith(
    "meeting",
    "trashed",
    undefined,
    { skipResourceBody: true },
  );
});
it("reads only the requested active meeting", async () => {
  expect(await action.run({ id: "active" })).toEqual({
    meeting: { actualEnd: null, captureStopRevision: 0 },
  });
});
it("does not reveal a trashed meeting when access is denied", async () => {
  access.resolve.mockResolvedValue(null);
  expect(await action.run({ id: "trashed" })).toEqual({
    meeting: null,
    reason: "unavailable",
  });
});
it("returns unavailable for a missing row", async () => {
  expect(await action.run({ id: "missing" })).toEqual({
    meeting: null,
    reason: "unavailable",
  });
});
it("propagates access read failures", async () => {
  access.resolve.mockRejectedValue(new Error("database offline"));
  await expect(action.run({ id: "trashed" })).rejects.toThrow(
    "database offline",
  );
});
