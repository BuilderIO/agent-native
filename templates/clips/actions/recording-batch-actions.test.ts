// guard:allow-unscoped — isolated PostgreSQL-compatible fixtures.
import { PGlite } from "@electric-sql/pglite";
import { sql, type SQLWrapper } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "../server/db/schema.js";

const identity = vi.hoisted(() => ({
  email: "owner@example.test",
  denied: new Set<string>(),
  // Recordings whose access check fails for a reason other than a refusal.
  unavailable: new Set<string>(),
  writeAppState: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => identity.email,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: identity.writeAppState,
  readAppState: async () => null,
}));
vi.mock("@agent-native/core/sharing", async (original) => {
  const actual = await original<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    assertAccess: async (_type: string, id: string) => {
      if (identity.denied.has(id)) throw new actual.ForbiddenError();
      if (identity.unavailable.has(id)) throw new Error("database unavailable");
      return { role: "owner", resource: { expiresAt: null } };
    },
  };
});
vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfiles: async () => new Map(),
}));
vi.mock("../server/db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../server/db/schema.js"),
}));
vi.mock("../server/lib/agent-recording-access.js", () => ({
  agentRecordingAccessFilter: () => sql`true`,
  isAgentRecordingCaller: () => false,
}));
vi.mock("../server/lib/recordings.js", async (original) => ({
  ...(await original<typeof import("../server/lib/recordings.js")>()),
  ownerEmailMatches: (column: SQLWrapper, email: string) =>
    sql`lower(${column}) = ${email.trim().toLowerCase()}`,
  getActiveOrganizationId: async () => null,
  countedViewCondition: () => sql`true`,
}));

const { default: archive } = await import("./archive-recording.js");
const { default: trash } = await import("./trash-recording.js");
const { default: restore } = await import("./restore-recording.js");
const { default: tag } = await import("./tag-recording.js");
const { default: addToSpace } = await import("./add-recording-to-space.js");
const { default: list } = await import("./list-recordings.js");
const { ForbiddenError } = await import("@agent-native/core/sharing");

const client = new PGlite();
const db = drizzle(client, { schema });
const owner = "owner@example.test";

async function insertRecording(
  id: string,
  fields: Partial<typeof schema.recordings.$inferInsert> = {},
) {
  await db.insert(schema.recordings).values({
    id,
    ownerEmail: owner,
    title: id,
    durationMs: 1000,
    editsJson: "{}",
    kind: "video",
    visibility: "private",
    spaceIds: "[]",
    createdAt: "2026-10-30T12:00:00.000Z",
    updatedAt: "2026-10-30T12:00:00.000Z",
    ...fields,
  });
}

async function recordingRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.recordings)
    .where(sql`${schema.recordings.id} = ${id}`);
  return row;
}

beforeAll(async () => {
  for (const table of [
    schema.recordings,
    schema.recordingTranscripts,
    schema.recordingTags,
    schema.recordingViewers,
    schema.recordingViews,
    schema.recordingAgentViews,
    schema.recordingContentBindings,
    schema.recordingShares,
    schema.meetings,
  ]) {
    const config = getTableConfig(table);
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    await client.exec(
      `create table ${quote(config.name)} (${config.columns.map((column) => `${quote(column.name)} ${column.getSQLType()}`).join(", ")})`,
    );
  }
});
beforeEach(async () => {
  identity.email = owner;
  identity.denied.clear();
  identity.unavailable.clear();
  identity.writeAppState.mockClear();
  await db.delete(schema.recordings);
  await db.delete(schema.recordingTags);
  await db.delete(schema.recordingShares);
});
afterAll(async () => {
  await client.close();
});

describe("batch recording actions", () => {
  it("archives every recording in one call and reports the one already archived", async () => {
    await insertRecording("a");
    await insertRecording("b");
    await insertRecording("c", { archivedAt: "2026-10-01T00:00:00.000Z" });

    const result = await archive.run(
      archive.schema.parse({ ids: ["a", "b", "c"] }),
    );

    expect(result).toMatchObject({ changed: 2, unchanged: 1, skipped: 0 });
    expect(
      "results" in result && result.results.map((r) => [r.id, r.status]),
    ).toEqual([
      ["a", "changed"],
      ["b", "changed"],
      ["c", "unchanged"],
    ]);
    expect((await recordingRow("a")).archivedAt).toBeTruthy();
    expect((await recordingRow("c")).archivedAt).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(identity.writeAppState).toHaveBeenCalledTimes(1);
  });

  it("changes nothing, and names the recording, when one can't be edited", async () => {
    await insertRecording("a");
    await insertRecording("b");
    identity.denied.add("b");

    await expect(
      trash.run(trash.schema.parse({ ids: ["a", "b"] })),
    ).rejects.toThrow(/Nothing was changed: 1 of 2 recordings .*b:/);

    expect((await recordingRow("a")).trashedAt).toBeNull();
    expect(identity.writeAppState).not.toHaveBeenCalled();
  });

  it("passes an operational failure through instead of calling it a refusal", async () => {
    await insertRecording("a");
    await insertRecording("b");
    identity.denied.add("a");
    identity.unavailable.add("b");

    const failed = trash.run(trash.schema.parse({ ids: ["a", "b"] }));
    await expect(failed).rejects.toThrow(/^database unavailable$/);
    await expect(failed).rejects.not.toBeInstanceOf(ForbiddenError);

    expect((await recordingRow("b")).trashedAt).toBeNull();
  });

  it("skips, with the reason, a recording that disappears after the check", async () => {
    await insertRecording("a");

    const result = await trash.run(trash.schema.parse({ ids: ["a", "gone"] }));

    expect(result).toMatchObject({ changed: 1, skipped: 1 });
    expect("results" in result && result.results[1]).toEqual({
      id: "gone",
      status: "skipped",
      reason: "Recording not found: gone",
    });
  });

  it("restores trashed and archived recordings together", async () => {
    await insertRecording("a", { trashedAt: "2026-10-31T00:00:00.000Z" });
    await insertRecording("b", { archivedAt: "2026-10-31T00:00:00.000Z" });
    await insertRecording("c");

    const result = await restore.run(
      restore.schema.parse({ ids: ["a", "b", "c"] }),
    );

    expect(result).toMatchObject({ changed: 2, unchanged: 1 });
    for (const id of ["a", "b"]) {
      const row = await recordingRow(id);
      expect([row.trashedAt, row.archivedAt]).toEqual([null, null]);
    }
  });

  it("tags and untags several recordings, counting ones already that way", async () => {
    await insertRecording("a");
    await insertRecording("b");
    await tag.run(tag.schema.parse({ recordingId: "a", tag: "demo" }));

    expect(
      await tag.run(
        tag.schema.parse({ recordingIds: ["a", "b"], tag: "demo" }),
      ),
    ).toMatchObject({ changed: 1, unchanged: 1 });
    expect(
      await tag.run(
        tag.schema.parse({
          recordingIds: ["a", "b"],
          tag: "demo",
          op: "remove",
        }),
      ),
    ).toMatchObject({ changed: 2, unchanged: 0 });
    expect(await db.select().from(schema.recordingTags)).toEqual([]);
  });

  it("adds several recordings to a space", async () => {
    await insertRecording("a", { spaceIds: '["space-1"]' });
    await insertRecording("b");

    const result = await addToSpace.run(
      addToSpace.schema.parse({ recordingIds: ["a", "b"], spaceId: "space-1" }),
    );

    expect(result).toMatchObject({ changed: 1, unchanged: 1 });
    expect((await recordingRow("b")).spaceIds).toBe('["space-1"]');
  });

  it("keeps the single-recording result shape", async () => {
    await insertRecording("a");

    const result = await archive.run(archive.schema.parse({ id: "a" }));

    expect(result).toEqual({ id: "a", archivedAt: expect.any(String) });
  });

  it("refuses more than 100 recordings in one call", () => {
    const ids = Array.from({ length: 101 }, (_, i) => `rec-${i}`);
    expect(archive.schema.safeParse({ ids }).success).toBe(false);
    expect(archive.schema.safeParse({}).success).toBe(false);
  });
});

describe("list-recordings batch filters", () => {
  const ids = async (args: Record<string, unknown>) =>
    (
      await list.run(list.schema.parse({ view: "all", ...args }), {
        userEmail: identity.email,
      } as never)
    ).recordings
      .map((row: { id: string }) => row.id)
      .sort();

  beforeEach(async () => {
    await insertRecording("old-public", {
      visibility: "public",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    await insertRecording("old-shared", {
      visibility: "org",
      createdAt: "2026-10-02T00:00:00.000Z",
    });
    await insertRecording("new-public", {
      visibility: "public",
      createdAt: "2026-10-31T00:00:00.000Z",
    });
    await insertRecording("old-private", {
      createdAt: "2026-10-03T00:00:00.000Z",
    });
    await insertRecording("theirs", {
      ownerEmail: "other@example.test",
      visibility: "public",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    await db.insert(schema.recordingShares).values([
      {
        id: "share-1",
        resourceId: "old-shared",
        principalType: "user",
        principalId: "friend@example.test",
        role: "viewer",
        createdBy: owner,
      },
      {
        id: "share-2",
        resourceId: "theirs",
        principalType: "user",
        principalId: owner,
        role: "viewer",
        createdBy: "other@example.test",
      },
    ] as never);
  });

  it("filters by creation date", async () => {
    expect(await ids({ createdBefore: "2026-10-25" })).toEqual([
      "old-private",
      "old-public",
      "old-shared",
      "theirs",
    ]);
    expect(await ids({ createdAfter: "2026-10-25T00:00:00Z" })).toEqual([
      "new-public",
    ]);
  });

  it("filters by visibility", async () => {
    expect(await ids({ visibility: ["public", "org"] })).toEqual([
      "new-public",
      "old-public",
      "old-shared",
      "theirs",
    ]);
  });

  it("finds the caller's own recordings shared with no one, or with someone", async () => {
    expect(
      await ids({
        createdBefore: "2026-10-25",
        visibility: ["public", "org"],
        hasShares: false,
      }),
    ).toEqual(["old-public"]);
    expect(await ids({ hasShares: "true" })).toEqual(["old-shared"]);
    expect(await ids({ hasShares: "false" })).not.toContain("old-shared");
  });

  it("refuses a hasShares value other than true or false", () => {
    for (const hasShares of ["TRUE", "yes", "flase", ""]) {
      expect(list.schema.safeParse({ hasShares }).success).toBe(false);
    }
  });

  it("rejects a date it can't read", () => {
    expect(list.schema.safeParse({ createdBefore: "last week" }).success).toBe(
      false,
    );
  });
});
