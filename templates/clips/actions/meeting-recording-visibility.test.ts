import { runWithRequestContext } from "@agent-native/core/server/request-context";
import {
  registerShareableResource,
  resolveAccess,
} from "@agent-native/core/sharing";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";

import * as schema from "../server/db/schema.js";

vi.mock("@agent-native/core/action", async (original) => ({
  ...(await original<typeof import("@agent-native/core/action")>()),
  defineAction: (options: unknown) => options,
}));
vi.mock("../server/db/index.js", async () => ({
  getDb: () => db,
  schema: await import("../server/db/schema.js"),
}));
vi.mock("../server/lib/calendar-event-meetings.js", () => ({
  parseCalendarMeetingId: () => null,
  materializeCalendarMeetingFromVirtualId: async () => null,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async () => null,
  readAppStateForCurrentTab: async () => ({
    view: "meeting",
    meetingId: "fake-meeting",
  }),
  writeAppState: async () => {},
}));
vi.mock("../server/lib/recordings.js", async (original) => ({
  ...(await original<typeof import("../server/lib/recordings.js")>()),
  getActiveOrganizationId: async () => null,
}));

vi.mock("@agent-native/core/server", async (original) => ({
  ...(await original<typeof import("@agent-native/core/server")>()),
  getSession: async () => null,
}));
vi.mock("h3", async (original) => ({
  ...(await original<typeof import("h3")>()),
  defineEventHandler: (handler: unknown) => handler,
  getQuery: () => ({ id: "fake-meeting" }),
  setResponseHeader: () => {},
  setResponseStatus: () => {},
}));
import publicMeeting from "../server/routes/api/public-meeting.get.js";
const cleanup = vi.hoisted(() =>
  vi.fn(async () => ({
    summaryMd: "Fake copied notes",
    bullets: [],
    actionItems: [],
    provider: "fixture",
  })),
);
vi.mock("./cleanup-transcript.js", () => ({ default: { run: cleanup } }));
vi.mock("./lib/agents-md-context.js", () => ({
  loadAgentsMdContext: async () => "",
}));
import finalizeMeeting from "./finalize-meeting.js";
import getMeeting from "./get-meeting.js";
import searchMeetings from "./search-meetings.js";
import startMeetingRecording from "./start-meeting-recording.js";
import viewScreen from "./view-screen.js";
const client = new PGlite();
const db = drizzle(client, { schema });
const viewerEmail = "viewer@example.test";
const ownerEmail = "clip-owner@example.test";
const now = "2026-10-27T12:00:00Z";
const asUser = <T>(email: string, work: () => T) =>
  runWithRequestContext({ userEmail: email }, work);

async function grantRecording() {
  await db.insert(schema.recordingShares).values({
    id: "fake-recording-grant",
    resourceId: "fake-clip",
    principalType: "user",
    principalId: viewerEmail,
    role: "viewer",
  });
}

describe("meeting-linked recording visibility with real sharing", () => {
  beforeAll(async () => {
    for (const table of [
      schema.recordings,
      schema.recordingShares,
      schema.recordingTranscripts,
      schema.meetings,
      schema.meetingShares,
      schema.meetingParticipants,
      schema.meetingActionItems,
    ]) {
      const config = getTableConfig(table);
      const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
      await client.exec(
        `create table ${quote(config.name)} (${config.columns.map((column) => `${quote(column.name)} ${column.getSQLType()}`).join(", ")})`,
      );
    }
    registerShareableResource({
      type: "recording",
      resourceTable: schema.recordings,
      sharesTable: schema.recordingShares,
      getDb: () => db,
      displayName: "Recording",
      titleColumn: "title",
    });
    registerShareableResource({
      type: "meeting",
      resourceTable: schema.meetings,
      sharesTable: schema.meetingShares,
      getDb: () => db,
      displayName: "Meeting",
      titleColumn: "title",
    });
  });
  beforeEach(async () => {
    cleanup.mockReset();
    cleanup.mockResolvedValue({
      summaryMd: "Fake copied notes",
      bullets: [],
      actionItems: [],
      provider: "fixture",
    });
    for (const table of [
      schema.recordings,
      schema.recordingShares,
      schema.recordingTranscripts,
      schema.meetings,
      schema.meetingShares,
      schema.meetingParticipants,
      schema.meetingActionItems,
    ])
      await db.delete(table);
    await db.insert(schema.recordings).values({
      id: "fake-clip",
      organizationId: "",
      ownerEmail,
      orgId: null,
      visibility: "private",
      title: "Fake Clip title",
      status: "ready",
      durationMs: 4000,
      videoUrl: "https://example.test/fake-private-media.webm",
      password: null,
      expiresAt: null,
      trashedAt: null,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.meetings).values({
      id: "fake-meeting",
      ownerEmail: "meeting-owner@example.test",
      orgId: null,
      visibility: "private",
      title: "Independent meeting title",
      summaryMd: "Independent meeting notes",
      userNotesMd: "",
      bulletsJson: "[]",
      actionItemsJson: "[]",
      recordingId: "fake-clip",
      shareTranscript: false,
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    for (const principalId of [viewerEmail, ownerEmail])
      await db.insert(schema.meetingShares).values({
        id: `fake-meeting-${principalId}`,
        resourceId: "fake-meeting",
        principalType: "user",
        principalId,
        role: "viewer",
      });
    await db.insert(schema.recordingTranscripts).values({
      recordingId: "fake-clip",
      ownerEmail,
      status: "ready",
      language: "en",
      fullText: "Fake private transcript",
      segmentsJson: "[]",
      updatedAt: now,
    });
  });
  afterAll(async () => {
    await client.close();
  });

  it("does not treat a meeting grant as a recording grant", async () => {
    await asUser(viewerEmail, async () => {
      expect(await resolveAccess("meeting", "fake-meeting")).toMatchObject({
        role: "viewer",
      });
      expect(await resolveAccess("recording", "fake-clip")).toBeNull();
      const result = await getMeeting.run({ id: "fake-meeting" });
      expect(result).toMatchObject({
        meeting: { summaryMd: "Independent meeting notes" },
        recording: null,
        transcript: null,
      });
    });
  });
  it("keeps meeting-only context within the same grant", async () => {
    await asUser(viewerEmail, async () => {
      const screen = JSON.parse(await viewScreen.run({}));
      expect(screen).toMatchObject({
        meeting: {
          meeting: { summaryMd: "Independent meeting notes" },
          recording: null,
          transcriptSnippet: null,
        },
      });
    });
  });
  it("does not search a transcript through a meeting-only grant", async () => {
    await asUser(viewerEmail, async () => {
      expect(
        await searchMeetings.run({
          query: "private transcript",
          limit: 1,
          includeTrashed: false,
        }),
      ).toMatchObject({ meetings: [] });
    });
  });
  it.each(["owner", "recording-viewer", "meeting-opt-in"])(
    "retains the established transcript grant (%s)",
    async (grant) => {
      if (grant === "recording-viewer") await grantRecording();
      if (grant === "meeting-opt-in")
        await db.update(schema.meetings).set({ shareTranscript: true });
      await asUser(grant === "owner" ? ownerEmail : viewerEmail, async () => {
        expect(await getMeeting.run({ id: "fake-meeting" })).toMatchObject({
          meeting: { summaryMd: "Independent meeting notes" },
          transcript: { fullText: "Fake private transcript" },
        });
      });
    },
  );
  it.each(["owner", "recording-viewer", "meeting-opt-in"])(
    "retains authorized context and transcript search (%s)",
    async (grant) => {
      if (grant === "recording-viewer") await grantRecording();
      if (grant === "meeting-opt-in")
        await db.update(schema.meetings).set({ shareTranscript: true });
      await asUser(grant === "owner" ? ownerEmail : viewerEmail, async () => {
        const screen = JSON.parse(await viewScreen.run({}));
        expect(screen).toMatchObject({
          meeting: {
            transcriptSnippet: "Fake private transcript",
            recording: grant === "meeting-opt-in" ? null : { id: "fake-clip" },
          },
        });
        expect(
          await searchMeetings.run({
            query: "private transcript",
            limit: 1,
            includeTrashed: false,
          }),
        ).toMatchObject({
          meetings: [{ id: "fake-meeting", matchType: "transcript" }],
        });
      });
    },
  );
  it("filters inaccessible transcript matches before pagination", async () => {
    await db.insert(schema.meetings).values({
      id: "fake-readable-meeting",
      ownerEmail: viewerEmail,
      orgId: null,
      visibility: "private",
      title: "Opted-in meeting",
      recordingId: "fake-clip",
      shareTranscript: true,
      createdAt: "2000-01-01T00:00:00Z",
    });
    await asUser(viewerEmail, async () => {
      const result = await searchMeetings.run({
        query: "private transcript",
        limit: 1,
        includeTrashed: false,
      });
      expect(result.meetings.map((meeting) => meeting.id)).toEqual([
        "fake-readable-meeting",
      ]);
    });
  });
  it.each(["password", "trash", "expiry", "takedown"])(
    "keeps public meeting transcripts behind source %s",
    async (gate) => {
      await db
        .update(schema.meetings)
        .set({ visibility: "public", shareTranscript: true });
      await db
        .update(schema.recordings)
        .set(
          gate === "password"
            ? { password: "FAKE_RECORDING_PASSWORD" }
            : gate === "trash"
              ? { trashedAt: now }
              : gate === "expiry"
                ? { expiresAt: "2000-01-01T00:00:00Z" }
                : { failureCode: "taken_down" },
        );
      const result = await publicMeeting({} as never);
      expect(result).toMatchObject({
        meeting: { summaryMd: "Independent meeting notes", transcript: null },
      });
    },
  );
  it("keeps the anonymous meeting SSR transcript behind the same source gate", async () => {
    await db
      .update(schema.meetings)
      .set({ visibility: "public", shareTranscript: true });
    await db
      .update(schema.recordings)
      .set({ password: "FAKE_RECORDING_PASSWORD" });
    const { loader } =
      await import("../app/routes/share.meeting.$meetingId.js");
    const result = await loader({
      params: { meetingId: "fake-meeting" },
      url: new URL("https://example.test/share/meeting/fake-meeting"),
    } as Parameters<typeof loader>[0]);
    expect(result).toMatchObject({
      meeting: { summaryMd: "Independent meeting notes", transcript: null },
    });
  });
  it.each(["api", "ssr"])(
    "retains explicit unprotected transcript publication through %s",
    async (surface) => {
      await db
        .update(schema.meetings)
        .set({ visibility: "public", shareTranscript: true });
      const result =
        surface === "api"
          ? await publicMeeting({} as never)
          : await (
              await import("../app/routes/share.meeting.$meetingId.js")
            ).loader({
              params: { meetingId: "fake-meeting" },
              url: new URL("https://example.test/share/meeting/fake-meeting"),
            } as never);
      expect(result).toMatchObject({
        meeting: { transcript: { fullText: "Fake private transcript" } },
      });
    },
  );
  it("requires a recording grant when reusing an existing meeting recording", async () => {
    await db.update(schema.meetingShares).set({ role: "editor" });
    await asUser(viewerEmail, async () => {
      await expect(
        startMeetingRecording.run({ meetingId: "fake-meeting" }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });
  it("does not generate meeting notes from an unshared recording", async () => {
    await db.update(schema.meetingShares).set({ role: "editor" });
    await db
      .update(schema.meetings)
      .set({ transcriptStatus: "ready", summaryMd: "" });
    await asUser(viewerEmail, async () => {
      await expect(
        finalizeMeeting.run({ meetingId: "fake-meeting", force: true }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
    expect(cleanup).not.toHaveBeenCalled();
    expect(
      await db
        .select({ summaryMd: schema.meetings.summaryMd })
        .from(schema.meetings),
    ).toEqual([{ summaryMd: "" }]);
  });
  it.each(["recording-grant", "meeting-opt-in"])(
    "rechecks transcript permission after cleanup (%s)",
    async (grant) => {
      await db.update(schema.meetingShares).set({ role: "editor" });
      await db.update(schema.meetings).set({
        transcriptStatus: "ready",
        summaryMd: "",
        shareTranscript: grant === "meeting-opt-in",
      });
      if (grant === "recording-grant") await grantRecording();
      cleanup.mockImplementationOnce(async () => {
        if (grant === "recording-grant")
          await db.delete(schema.recordingShares);
        else await db.update(schema.meetings).set({ shareTranscript: false });
        return {
          summaryMd: "Fake copied notes",
          bullets: [],
          actionItems: [],
          provider: "fixture",
        };
      });
      await asUser(viewerEmail, async () => {
        await expect(
          finalizeMeeting.run({ meetingId: "fake-meeting", force: true }),
        ).rejects.toMatchObject({ statusCode: 403 });
      });
      expect(cleanup).toHaveBeenCalledOnce();
      expect(
        await db
          .select({
            summaryMd: schema.meetings.summaryMd,
            status: schema.meetings.transcriptStatus,
          })
          .from(schema.meetings),
      ).toEqual([{ summaryMd: "", status: "failed" }]);
    },
  );
  it("generates notes from an explicitly shared transcript without Clip metadata", async () => {
    await db.update(schema.meetingShares).set({ role: "editor" });
    await db
      .update(schema.meetings)
      .set({ transcriptStatus: "ready", summaryMd: "", shareTranscript: true });
    await asUser(viewerEmail, async () => {
      expect(
        await finalizeMeeting.run({ meetingId: "fake-meeting", force: true }),
      ).toMatchObject({ summaryMd: "Fake copied notes" });
    });
    expect(cleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: "Fake private transcript",
        contextPack: expect.objectContaining({
          snippets: expect.not.arrayContaining([
            expect.objectContaining({ label: "Linked Clip" }),
          ]),
        }),
      }),
    );
  });
  it("keeps explicitly opted-in meeting transcript sharing without sharing the Clip row", async () => {
    await db.update(schema.meetings).set({ shareTranscript: true });
    await asUser(viewerEmail, async () => {
      const result = await getMeeting.run({ id: "fake-meeting" });
      expect(result.recording).toBeNull();
      expect(result.transcript).toEqual({
        status: "ready",
        language: "en",
        fullText: "Fake private transcript",
        segmentsJson: "[]",
        updatedAt: now,
      });
    });
  });
  it.each([false, true])(
    "projects only safe Clip/transcript fields for a direct grant (owner=%s)",
    async (owner) => {
      if (!owner) await grantRecording();
      await asUser(owner ? ownerEmail : viewerEmail, async () => {
        const result = await getMeeting.run({ id: "fake-meeting" });
        expect(result.recording).toEqual({
          id: "fake-clip",
          title: "Fake Clip title",
          status: "ready",
          durationMs: 4000,
        });
        expect(result.transcript).toEqual({
          status: "ready",
          language: "en",
          fullText: "Fake private transcript",
          segmentsJson: "[]",
          updatedAt: now,
        });
      });
    },
  );
  it("does not let a meeting opt-in bypass a protected Clip", async () => {
    await grantRecording();
    await db.update(schema.meetings).set({ shareTranscript: true });
    await db
      .update(schema.recordings)
      .set({ password: "FAKE_RECORDING_PASSWORD" });
    await asUser(viewerEmail, async () => {
      expect(await getMeeting.run({ id: "fake-meeting" })).toMatchObject({
        recording: null,
        transcript: null,
      });
    });
    await asUser(ownerEmail, async () => {
      expect(await getMeeting.run({ id: "fake-meeting" })).toMatchObject({
        recording: { id: "fake-clip" },
        transcript: { fullText: "Fake private transcript" },
      });
    });
  });
});
