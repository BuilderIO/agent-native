import {
  organizations,
  orgMembers,
  orgInvitations,
} from "@agent-native/core/org";
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
  email: "viewer@example.test" as string | undefined,
  cleanup: vi.fn(async () => ({
    summaryMd: "Fake generated notes",
    bullets: [],
    actionItems: [],
    provider: "fixture",
  })),
  navigation: { view: "shared", meetingId: "fake-meeting" },
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => identity.email,
}));
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: async () => {},
  readAppState: async () => null,
  readAppStateForCurrentTab: async (key: string) =>
    key === "navigation" ? identity.navigation : null,
}));
vi.mock("@agent-native/core/sharing", async (original) => ({
  ...(await original<typeof import("@agent-native/core/sharing")>()),
  assertAccess: async () => ({ role: "editor" }),
  accessFilter: () => sql`true`,
  resolveAccess: async () => ({ role: "owner" }),
}));
vi.mock("./cleanup-transcript.js", () => ({
  default: { run: identity.cleanup },
}));
vi.mock("./lib/agents-md-context.js", () => ({
  loadAgentsMdContext: async () => "",
}));
vi.mock("../server/lib/calendar-event-meetings.js", () => ({
  parseCalendarMeetingId: () => null,
}));
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
vi.mock("../server/lib/recordings.js", () => ({
  ownerEmailMatches: (column: SQLWrapper, email: string) =>
    sql`lower(${column}) = ${email.trim().toLowerCase()}`,
  getActiveOrganizationId: async () => "fake-org",
  getCurrentOwnerEmail: () => identity.email,
  requireOrganizationAccess: async () => ({ organizationId: "fake-org" }),
  sameOwnerEmail: (a: string, b: string) =>
    Boolean(a && b) && a.toLowerCase() === b.toLowerCase(),
  countedViewCondition: () => sql`true`,
  parseSpaceIds: () => [],
}));
import csv from "./export-insights-csv.js";
import finalizeMeeting from "./finalize-meeting.js";
import meeting from "./get-meeting.js";
import insights from "./get-organization-insights.js";
import organization from "./list-organization-state.js";
import action from "./list-recordings.js";
import searchMeetings from "./search-meetings.js";
import screen from "./view-screen.js";
const client = new PGlite();
const db = drizzle(client, { schema });
const now = "2026-07-15T12:00:00.000Z";
const args = {
  view: "all" as const,
  sort: "recent" as const,
  limit: 1,
  offset: 0,
  includeMedia: true,
  countOnly: false,
};

describe("list recordings expiry with PostgreSQL", () => {
  beforeAll(async () => {
    for (const table of [
      schema.recordings,
      schema.recordingTranscripts,
      schema.recordingTags,
      schema.recordingViewers,
      schema.recordingViews,
      schema.recordingAgentViews,
      schema.recordingComments,
      schema.recordingReactions,
      schema.recordingEvents,
      schema.recordingContentBindings,
      schema.meetings,
      schema.meetingShares,
      schema.meetingParticipants,
      schema.meetingActionItems,
      schema.folders,
      schema.spaces,
      schema.organizationSettings,
      organizations,
      orgMembers,
      orgInvitations,
    ]) {
      const config = getTableConfig(table);
      const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
      await client.exec(
        `create table ${quote(config.name)} (${config.columns.map((column) => `${quote(column.name)} ${column.getSQLType()}`).join(", ")})`,
      );
    }
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(now));
  });
  beforeEach(async () => {
    identity.cleanup.mockClear();
    await db.delete(schema.recordings);
    await db.delete(schema.recordingTranscripts);
    await db.delete(schema.meetings);
    await db.delete(schema.folders);
    await db.delete(organizations);
    identity.navigation = { view: "shared", meetingId: "fake-meeting" };
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await client.close();
  });
  it.each([
    { expiresAt: "2000-01-01T00:00:00Z", unavailable: true },
    { expiresAt: "not-a-date", unavailable: true },
    { expiresAt: "2030-02-30T12:00:00Z", unavailable: true },
    { expiresAt: "2030-01-01T00:00:00.1234567Z", unavailable: true },
    { expiresAt: "2030-01-01T00:00:00+23:00", unavailable: true },
    { expiresAt: "2030-01-01T00:00:00.123456Z", unavailable: false },
    { expiresAt: now, unavailable: false },
    { expiresAt: null, unavailable: false },
  ])(
    "filters $expiresAt before count and pagination",
    async ({ expiresAt, unavailable }) => {
      await db.insert(schema.recordings).values([
        {
          id: "first",
          ownerEmail: "owner@example.test",
          title: "First",
          expiresAt,
          durationMs: 1000,
          editsJson: "{}",
          kind: "video",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "second",
          ownerEmail: "owner@example.test",
          title: "Second",
          expiresAt: null,
          durationMs: 1000,
          editsJson: "{}",
          kind: "video",
          createdAt: "2026-07-14T12:00:00Z",
          updatedAt: now,
        },
      ]);
      identity.email = "viewer@example.test";
      const viewer = await action.run(args, {
        userEmail: identity.email,
      } as never);
      expect(viewer.recordings.map((row) => row.id)).toEqual([
        unavailable ? "second" : "first",
      ]);
      expect(
        await action.run({ ...args, countOnly: true }, {
          userEmail: identity.email,
        } as never),
      ).toMatchObject({ total: unavailable ? 1 : 2 });
      identity.email = "OWNER@example.test";
      expect(
        (
          await action.run(args, { userEmail: identity.email } as never)
        ).recordings.map((row) => row.id),
      ).toEqual(["first"]);
      expect(
        await action.run({ ...args, countOnly: true }, {
          userEmail: identity.email,
        } as never),
      ).toMatchObject({ total: 2 });
    },
  );

  it.each(
    [
      "csv",
      "insights",
      "folders",
      "library",
      "meeting",
      "meeting screen",
      "meeting search",
      "meeting finalize",
      "meeting finalize override",
    ].flatMap((surface) =>
      ["2000-01-01T00:00:00Z", "not-a-date"].map((expiresAt) => ({
        surface,
        expiresAt,
      })),
    ),
  )(
    "applies expiry to $surface ($expiresAt)",
    async ({ surface, expiresAt }) => {
      await db.insert(schema.recordings).values([
        {
          id: "expired",
          title: "Fake expired title",
          ownerEmail: "owner@example.test",
          expiresAt,
          organizationId: "fake-org",
          folderId: "fake-folder",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "live",
          title: "Fake live title",
          ownerEmail: "owner@example.test",
          expiresAt: null,
          organizationId: "fake-org",
          folderId: "fake-folder",
          createdAt: now,
          updatedAt: now,
        },
      ]);
      await db
        .insert(organizations)
        .values({ id: "fake-org", name: "Fake org" });
      await db.insert(schema.folders).values({
        id: "fake-folder",
        name: "Fake folder",
        ownerEmail: "viewer@example.test",
        organizationId: "fake-org",
        spaceId: "fake-space",
      });
      if (surface.startsWith("meeting")) {
        await db.insert(schema.meetings).values({
          id: "fake-meeting",
          title: "Fake meeting",
          ownerEmail: "viewer@example.test",
          recordingId: "expired",
          transcriptStatus: "ready",
          userNotesMd: "",
          updatedAt: now,
        });
        await db
          .insert(schema.recordingTranscripts)
          .values({ recordingId: "expired", fullText: "Fake transcript" });
        identity.navigation.view = "meeting";
      }
      for (const owner of [false, true]) {
        identity.email = owner ? "OWNER@example.test" : "viewer@example.test";
        if (surface === "csv")
          expect((await csv.run({})).rows).toBe(owner ? 2 : 1);
        if (surface === "insights")
          expect(
            (await insights.run({ days: 30, topN: 10 })).topCreators,
          ).toMatchObject([{ recordings: owner ? 2 : 1 }]);
        if (surface === "folders")
          expect(
            await organization.run({}, { userEmail: identity.email } as never),
          ).toMatchObject({ folders: [{ recordingCount: owner ? 2 : 1 }] });
        if (surface === "library") {
          identity.navigation.view = owner ? "library" : "shared";
          const result = JSON.parse(await screen.run({}));
          expect(owner ? result.library : result.shared).toMatchObject({
            count: owner ? 2 : 1,
          });
        }
        if (surface === "meeting search")
          expect(
            (
              await searchMeetings.run({
                query: "transcript",
                limit: 1,
                includeTrashed: false,
              })
            ).meetings,
          ).toHaveLength(owner ? 1 : 0);
        if (surface.startsWith("meeting finalize")) {
          const args = {
            meetingId: "fake-meeting",
            force: true,
            ...(surface.endsWith("override")
              ? { overrideTranscript: "Fake override transcript" }
              : {}),
          };
          if (!owner) {
            await expect(finalizeMeeting.run(args)).rejects.toMatchObject({
              statusCode: 403,
            });
            expect(identity.cleanup).not.toHaveBeenCalled();
            expect(
              await db
                .select({
                  transcriptStatus: schema.meetings.transcriptStatus,
                  summaryMd: schema.meetings.summaryMd,
                })
                .from(schema.meetings),
            ).toEqual([{ transcriptStatus: "ready", summaryMd: null }]);
          } else {
            await expect(finalizeMeeting.run(args)).resolves.toMatchObject({
              summaryMd: "Fake generated notes",
            });
            expect(identity.cleanup).toHaveBeenCalledOnce();
            expect(
              await db
                .select({ summaryMd: schema.meetings.summaryMd })
                .from(schema.meetings),
            ).toEqual([{ summaryMd: "Fake generated notes" }]);
          }
        }
        if (surface === "meeting")
          expect(await meeting.run({ id: "fake-meeting" })).toMatchObject({
            recording: owner ? { id: "expired" } : null,
            transcript: owner ? { fullText: "Fake transcript" } : null,
          });
        if (surface === "meeting screen")
          expect(JSON.parse(await screen.run({}))).toMatchObject({
            meeting: {
              recording: owner ? { id: "expired" } : null,
              transcriptSnippet: owner ? "Fake transcript" : null,
            },
          });
      }
    },
  );
  it.each([false, true])(
    "rechecks linked expiry after meeting cleanup (owner=%s)",
    async (owner) => {
      identity.email = owner ? "owner@example.test" : "viewer@example.test";
      await db.insert(schema.recordings).values({
        id: "linked",
        ownerEmail: "owner@example.test",
        title: "Fake Clip",
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.meetings).values({
        id: "fake-meeting",
        ownerEmail: identity.email,
        title: "Fake meeting",
        recordingId: "linked",
        transcriptStatus: "ready",
        userNotesMd: "",
        updatedAt: now,
      });
      identity.cleanup.mockImplementationOnce(async () => {
        await db
          .update(schema.recordings)
          .set({ expiresAt: "2000-01-01T00:00:00Z" });
        return {
          summaryMd: "Fake generated notes",
          bullets: [],
          actionItems: [],
          provider: "fixture",
        };
      });
      const pending = finalizeMeeting.run({
        meetingId: "fake-meeting",
        force: true,
        overrideTranscript: "Fake independent transcript",
      });
      if (owner)
        await expect(pending).resolves.toMatchObject({
          summaryMd: "Fake generated notes",
        });
      else await expect(pending).rejects.toMatchObject({ statusCode: 403 });
      expect(identity.cleanup).toHaveBeenCalledOnce();
      expect(
        await db
          .select({
            summaryMd: schema.meetings.summaryMd,
            transcriptStatus: schema.meetings.transcriptStatus,
          })
          .from(schema.meetings),
      ).toEqual([
        {
          summaryMd: owner ? "Fake generated notes" : null,
          transcriptStatus: owner ? "ready" : "failed",
        },
      ]);
    },
  );

  it.each([false, true])(
    "handles a permanently deleted recording link (override=%s)",
    async (override) => {
      identity.email = "viewer@example.test";
      await db.insert(schema.meetings).values({
        id: "fake-meeting",
        title: "Fake meeting",
        ownerEmail: identity.email,
        recordingId: "deleted-recording",
        transcriptStatus: "ready",
        userNotesMd: "",
        updatedAt: now,
      });
      // A dangling transcript must not supply content when its recording is absent.
      await db.insert(schema.recordingTranscripts).values({
        recordingId: "deleted-recording",
        fullText: "Fake orphan transcript",
      });
      const result = await finalizeMeeting.run({
        meetingId: "fake-meeting",
        force: override,
        ...(override
          ? { overrideTranscript: "Fake independent meeting transcript" }
          : {}),
      });
      if (override) {
        expect(result).toMatchObject({ summaryMd: "Fake generated notes" });
        expect(identity.cleanup).toHaveBeenCalledOnce();
        expect(identity.cleanup).toHaveBeenCalledWith(
          expect.objectContaining({
            transcript: "Fake independent meeting transcript",
          }),
        );
      } else {
        expect(result).toMatchObject({ skipped: "no-transcript" });
        expect(identity.cleanup).not.toHaveBeenCalled();
      }
      expect(
        await db
          .select({ summaryMd: schema.meetings.summaryMd })
          .from(schema.meetings),
      ).toEqual([{ summaryMd: override ? "Fake generated notes" : null }]);
    },
  );
});
