import { createRequire } from "node:module";

import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
let client: Awaited<ReturnType<typeof PGlite.create>>;
let db: ReturnType<typeof drizzle>;

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: async () => ({ role: "owner" }),
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: async () => {},
}));
vi.mock("@agent-native/core/sharing/actions/share-resource", () => ({
  default: { run: vi.fn() },
}));
vi.mock("../server/db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../server/db/schema.js"),
}));

import { meetings } from "../server/db/schema";
import action from "./stop-meeting-recording";

afterEach(async () => {
  await client?.close();
});

it("advances every stop atomically without replacing the original meeting end", async () => {
  client = await PGlite.create("memory://");
  db = drizzle(client);
  const columns = Object.values(getTableColumns(meetings)).map(
    (column) => `"${column.name}" ${column.getSQLType()}`,
  );
  await client.exec(`CREATE TABLE clips_meetings (${columns.join(", ")})`);
  await client.query(
    `INSERT INTO clips_meetings
      (id, owner_email, visibility, actual_end, capture_stop_revision, transcript_status, updated_at)
      VALUES ($1, $2, 'private', $3, 7, 'pending', $3)`,
    ["meeting-1", "owner@example.com", "2026-10-20T16:00:00Z"],
  );

  await Promise.all([
    action.run({ meetingId: "meeting-1", reason: "manual" }),
    action.run({ meetingId: "meeting-1", reason: "manual" }),
  ]);

  const rows = await db.select().from(meetings);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actualEnd: "2026-10-20T16:00:00Z",
    captureStopRevision: 9,
    transcriptStatus: "pending",
    updatedAt: "2026-10-20T16:00:00Z",
  });
});
