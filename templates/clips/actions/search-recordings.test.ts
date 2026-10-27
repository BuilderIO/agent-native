import { PGlite } from "@electric-sql/pglite";
import { sql, type SQLWrapper } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
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

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
  embedApp: () => ({}),
}));
vi.mock("@agent-native/core/server", () => ({ buildDeepLink: vi.fn() }));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => null,
}));
vi.mock("../server/db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../server/db/schema.js"),
}));
vi.mock("../server/lib/agent-recording-access.js", () => ({
  agentRecordingAccessFilter: () => sql`true`,
  isAgentRecordingCaller: () => false,
}));
vi.mock("../server/lib/recordings.js", () => ({
  ownerEmailMatches: (column: SQLWrapper, email: string) =>
    sql`lower(${column}) = ${email.trim().toLowerCase()}`,
}));

import action from "./search-recordings.js";

const client = new PGlite();
let db: PgliteDatabase<typeof schema>;
const now = "2026-07-15T12:00:00.000Z";

async function createQueryTable(table: PgTable) {
  const config = getTableConfig(table);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  await client.exec(
    `create table ${quote(config.name)} (${config.columns
      .map((column) => `${quote(column.name)} ${column.getSQLType()}`)
      .join(", ")})`,
  );
}

// oracle-change: Replace predicate-shape mocks with executed PostgreSQL coverage of all three search queries, owner/Trash and comments-off controls, expiry offsets, and filtering before limits.
type MatchSource = "title" | "transcript" | "comment";
async function seedMatch(
  source: MatchSource,
  id: string,
  expiresAt: string | null,
  options: { enableComments?: boolean; trashedAt?: string | null } = {},
) {
  await db.insert(schema.recordings).values({
    id,
    organizationId: "fake-workspace",
    ownerEmail: "owner@example.test",
    title: source === "title" ? "Fake needle recording" : "Fake recording",
    description: "",
    kind: "video",
    enableComments: options.enableComments ?? true,
    expiresAt,
    trashedAt: options.trashedAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
  if (source === "comment")
    await db.insert(schema.recordingComments).values({
      id: "comment-" + id,
      organizationId: "fake-workspace",
      recordingId: id,
      threadId: "thread-" + id,
      authorEmail: "owner@example.test",
      content: "Fake needle discussion " + id,
      videoTimestampMs: 1000,
      createdAt: now,
      updatedAt: now,
    });
  if (source === "transcript")
    await db.insert(schema.recordingTranscripts).values({
      recordingId: id,
      ownerEmail: "owner@example.test",
      fullText: "Fake needle transcript " + id,
      segmentsJson: "[]",
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
}
describe("recording search with PostgreSQL queries", () => {
  beforeAll(async () => {
    db = drizzle(client, { schema });
    for (const table of [
      schema.recordings,
      schema.recordingTranscripts,
      schema.recordingComments,
    ])
      await createQueryTable(table);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(now));
  });
  beforeEach(async () => {
    await db.delete(schema.recordingComments);
    await db.delete(schema.recordingTranscripts);
    await db.delete(schema.recordings);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await client.close();
  });
  for (const source of ["title", "transcript", "comment"] as const)
    describe(source + " matches", () => {
      it.each([
        {
          email: "viewer@example.test",
          expiresAt: "2000-01-01T00:00:00Z",
          visible: false,
        },
        { email: undefined, expiresAt: "2000-01-01T00:00:00Z", visible: false },
        {
          email: "viewer@example.test",
          expiresAt: "2026-07-15T13:00:00+02:00",
          visible: false,
        },
        {
          email: "viewer@example.test",
          expiresAt: "2026-07-15T11:00:00-02:00",
          visible: true,
        },
        { email: "viewer@example.test", expiresAt: now, visible: true },
        {
          email: "viewer@example.test",
          expiresAt: "2026-07-16T12:00:00.123456Z",
          visible: true,
        },
        {
          email: "viewer@example.test",
          expiresAt: "2026-07-16",
          visible: true,
        },
        {
          email: "viewer@example.test",
          expiresAt: "2026-07-16T12:00:00",
          visible: true,
        },
        { email: "viewer@example.test", expiresAt: null, visible: true },
        { email: "viewer@example.test", expiresAt: "", visible: true },
        {
          email: "OWNER@example.test",
          expiresAt: "2000-01-01T00:00:00Z",
          visible: true,
        },
        { email: "owner@example.test", expiresAt: "not-a-date", visible: true },
      ])(
        "filters expiry for $email / $expiresAt",
        async ({ email, expiresAt, visible }) => {
          await seedMatch(source, "fake-recording", expiresAt);
          const result = await action.run({ query: "needle", limit: 30 }, {
            userEmail: email,
          } as never);
          expect(result.results.map((row) => row.id)).toEqual(
            visible ? ["fake-recording"] : [],
          );
        },
      );
      it.each([
        { email: "owner@example.test", visible: true },
        { email: "viewer@example.test", visible: false },
        { email: undefined, visible: false },
      ])("returns Trash only to $email", async ({ email, visible }) => {
        await seedMatch(source, "trashed-recording", null, { trashedAt: now });
        const result = await action.run({ query: "needle", limit: 30 }, {
          userEmail: email,
        } as never);
        expect(
          result.results.map((row) => ({
            id: row.id,
            trashedAt: row.trashedAt,
          })),
        ).toEqual(visible ? [{ id: "trashed-recording", trashedAt: now }] : []);
      });
      it("filters expiry before the result limit", async () => {
        await seedMatch(source, "expired-first", "2000-01-01T00:00:00Z");
        await seedMatch(source, "available-second", null);
        const result = await action.run({ query: "needle", limit: 1 }, {
          userEmail: "viewer@example.test",
        } as never);
        expect(result.results.map((row) => row.id)).toEqual([
          "available-second",
        ]);
      });
      it.each([
        "not-a-date",
        "2030-02-30T12:00:00Z",
        "12:30:00",
        "2030-01-01T00:00:00+23:00",
        "2030-01-01T00:00:00.1234567Z",
      ])(
        "keeps valid matches available beside malformed expiry %s",
        async (expiresAt) => {
          await seedMatch(source, "invalid-first", expiresAt);
          await seedMatch(source, "available-second", null);
          const result = await action.run({ query: "needle", limit: 1 }, {
            userEmail: "viewer@example.test",
          } as never);
          expect(result.results.map((row) => row.id)).toEqual([
            "available-second",
          ]);
        },
      );
      it("reports malformed expiry to its owner for repair", async () => {
        await seedMatch(source, "invalid-expiry", "not-a-date");
        const result = await action.run({ query: "needle", limit: 1 }, {
          userEmail: "OWNER@example.test",
        } as never);
        expect(result.results.map((row) => row.id)).toEqual(["invalid-expiry"]);
        expect(result).toMatchObject({
          warnings: [
            {
              code: "invalid_recording_expiry",
              recordingIds: ["invalid-expiry"],
            },
          ],
        });
      });
    });
  it.each([
    { email: "viewer@example.test", enableComments: false, visible: false },
    { email: "owner@example.test", enableComments: false, visible: true },
    { email: "viewer@example.test", enableComments: true, visible: true },
  ])(
    "applies comment visibility before returning snippets: %j",
    async ({ email, enableComments, visible }) => {
      await seedMatch("comment", "fake-recording", null, { enableComments });
      const result = await action.run({ query: "needle", limit: 30 }, {
        userEmail: email,
      } as never);
      expect(
        result.results.map((row) => ({ id: row.id, snippet: row.snippet })),
      ).toEqual(
        visible
          ? [
              {
                id: "fake-recording",
                snippet: "Fake needle discussion fake-recording",
              },
            ]
          : [],
      );
    },
  );
  it.each(["title", "transcript"] as const)(
    "keeps %s matches available with comments disabled",
    async (source) => {
      await seedMatch(source, "fake-recording", null, {
        enableComments: false,
      });
      const result = await action.run({ query: "needle", limit: 30 }, {
        userEmail: "viewer@example.test",
      } as never);
      expect(result.results.map((row) => row.id)).toEqual(["fake-recording"]);
    },
  );
});
