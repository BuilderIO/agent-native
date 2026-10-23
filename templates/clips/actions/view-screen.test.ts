import { beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({
  navigation: { view: "library", recordingId: "rec-test" },
  recording: null as Record<string, unknown> | null,
  email: "viewer@example.com",
  childReads: vi.fn(),
}));

const TABLES = vi.hoisted(() => ({
  recordings: {
    id: "recordings.id",
    ownerEmail: "recordings.ownerEmail",
    organizationId: "recordings.organizationId",
    archivedAt: "recordings.archivedAt",
    trashedAt: "recordings.trashedAt",
    folderId: "recordings.folderId",
    updatedAt: "recordings.updatedAt",
  },
  meetings: { recordingId: "meetings.recordingId" },
  folders: {
    ownerEmail: "folders.ownerEmail",
    spaceId: "folders.spaceId",
    position: "folders.position",
  },
}));

const mockRecordingsWhere = vi.hoisted(() =>
  vi.fn((condition: unknown) => ({
    orderBy: () => ({ limit: async () => [] }),
    __condition: condition,
  })),
);
const mockMeetingsWhere = vi.hoisted(() =>
  vi.fn((condition: unknown) => ({
    kind: "meetings-subquery",
    condition,
    resolvedDb: true,
  })),
);

const makeRealDb = vi.hoisted(() => () => ({
  select: (_projection?: unknown) => ({
    from: (table: any) => {
      if (context.recording) {
        if (table === TABLES.recordings) {
          return { where: async () => [context.recording] };
        }
        context.childReads(table);
        const rows =
          table === "recordingComments"
            ? [
                {
                  id: "comment-test",
                  content: "Fake discussion",
                  authorEmail: "author@example.com",
                },
              ]
            : [];
        return {
          where: () =>
            Object.assign(Promise.resolve(rows), {
              orderBy: async () => rows,
              limit: async () => rows,
            }),
        };
      }
      if (table && "recordingId" in table) return { where: mockMeetingsWhere };
      if (table && "position" in table) {
        return { where: () => ({ orderBy: async () => [] }) };
      }
      return { where: mockRecordingsWhere };
    },
  }),
}));

const makeLazyProxy = vi.hoisted(
  () =>
    function makeLazyProxy(
      realDb: any,
      chain: Array<{ prop: string | symbol; args?: any[] }> = [],
    ): any {
      return new Proxy(function () {} as any, {
        get(_target, prop) {
          if (prop === "then" || prop === "catch" || prop === "finally") {
            const promise = Promise.resolve().then(() => {
              let result: any = realDb;
              for (const step of chain) {
                const val = result[step.prop];
                result =
                  typeof val === "function"
                    ? val.apply(result, step.args)
                    : val;
              }
              return result;
            });
            return (promise as any)[prop].bind(promise);
          }
          if (prop === "getSQL" || prop === "shouldOmitSQLParens") {
            throw new Error(
              "getDb(): accessed an unresolved query chain synchronously " +
                `(reading '${String(prop)}'). This chain was embedded as a raw ` +
                "value instead of being awaited first.",
            );
          }
          return makeLazyProxy(realDb, [...chain, { prop }]);
        },
        apply(_target, _thisArg, args) {
          if (chain.length === 0) return makeLazyProxy(realDb, []);
          const last = chain[chain.length - 1];
          return makeLazyProxy(realDb, [
            ...chain.slice(0, -1),
            { prop: last.prop, args },
          ]);
        },
      });
    },
);

const mockNotInArray = vi.hoisted(() =>
  vi.fn((column: unknown, values: unknown) => {
    const probed =
      values !== null && values !== undefined
        ? typeof (values as any).getSQL
        : "undefined";
    return { kind: "not-in-array", column, values, probed };
  }),
);

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async () => null,
  readAppStateForCurrentTab: async (key: string) =>
    key === "navigation" ? context.navigation : null,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => context.email,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ kind: "access-filter" }),
  resolveAccess: async () => null,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  asc: (column: unknown) => ({ kind: "asc", column }),
  desc: (column: unknown) => ({ kind: "desc", column }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  gte: vi.fn(),
  isNotNull: (column: unknown) => ({ kind: "is-not-null", column }),
  isNull: (column: unknown) => ({ kind: "is-null", column }),
  lte: vi.fn(),
  not: (value: unknown) => ({ kind: "not", value }),
  notInArray: (column: unknown, values: unknown) =>
    mockNotInArray(column, values),
  sql: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => makeLazyProxy(makeRealDb()),
  schema: {
    meetings: TABLES.meetings,
    folders: TABLES.folders,
    recordings: TABLES.recordings,
    recordingShares: "recordingShares",
    recordingViewers: "recordingViewers",
    recordingComments: "recordingComments",
    recordingTranscripts: { recordingId: "transcripts.recordingId" },
    recordingBrowserDiagnostics: { recordingId: "diagnostics.recordingId" },
  },
}));

vi.mock("../server/lib/agent-recording-access.js", () => ({
  agentRecordingAccessFilter: () => ({ kind: "agent-access-filter" }),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getActiveOrganizationId: async () => "org_123",
  ownerEmailMatches: (column: unknown, email: string) => ({
    kind: "owner-email",
    column,
    email,
  }),
  parseSpaceIds: vi.fn(),
  sameOwnerEmail: (a: string, b: string) =>
    a?.toLowerCase() === b?.toLowerCase(),
}));

vi.mock("../server/lib/user-identities.js", () => ({
  hydrateCommentAuthorNames: async (rows: unknown[]) => rows,
}));

vi.mock("../shared/browser-diagnostics.js", () => ({
  parseBrowserDiagnosticsRow: () => null,
}));

vi.mock("./lib/transcript-preview.js", () => ({
  buildTranscriptPreview: () => null,
}));

import action from "./view-screen";

describe("view-screen library view on a cold start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context.recording = null;
    context.navigation.view = "library";
  });

  it("builds the meeting-exclusion subquery off a resolved db, not the lazy proxy", async () => {
    await expect(action.run({})).resolves.toBeTypeOf("string");

    expect(mockNotInArray).toHaveBeenCalledTimes(1);
    const [column, values] = mockNotInArray.mock.calls[0]!;
    expect(column).toBe("recordings.id");
    expect((mockNotInArray.mock.results[0]!.value as any).probed).toBe(
      "undefined",
    );
    expect((values as any).resolvedDb).toBe(true);
  });

  it("excludes meeting recordings database-side rather than materializing ids", async () => {
    await action.run({});

    const [, values] = mockNotInArray.mock.calls[0]!;
    expect(Array.isArray(values)).toBe(false);
    expect((values as any).kind).toBe("meetings-subquery");
    expect((values as any).condition).toEqual({
      kind: "is-not-null",
      column: TABLES.meetings.recordingId,
    });
  });

  it("keeps the meeting exclusion in the recordings where-clause", async () => {
    await action.run({});

    expect(mockRecordingsWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "and",
        conditions: expect.arrayContaining([
          mockNotInArray.mock.results[0]!.value,
        ]),
      }),
    );
  });
});

describe("view-screen recording access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context.navigation.view = "recording";
    context.email = "viewer@example.com";
    context.recording = {
      id: "rec-test",
      title: "Fake recording",
      ownerEmail: "owner@example.com",
      status: "ready",
      enableComments: true,
      trashedAt: null,
      expiresAt: null,
    };
  });

  it.each([
    { trashedAt: "2026-01-01T00:00:00Z" },
    { expiresAt: "2020-01-01T00:00:00Z" },
  ])("withholds recording context after access ends: %j", async (settings) => {
    Object.assign(context.recording!, settings);
    const screen = JSON.parse(await action.run({}));
    expect(screen.recording).toBeUndefined();
    expect(screen.comments).toBeUndefined();
    expect(screen.transcript).toBeUndefined();
    expect(context.childReads).not.toHaveBeenCalled();
  });

  it.each(["viewer@example.com", "owner@example.com"])(
    "applies owner visibility to disabled comments for %s",
    async (email) => {
      context.email = email;
      context.recording!.enableComments = false;
      const screen = JSON.parse(await action.run({}));
      expect(screen.recording.id).toBe("rec-test");
      expect(
        screen.comments.map((comment: { content: string }) => comment.content),
      ).toEqual(email === "owner@example.com" ? ["Fake discussion"] : []);
      if (email !== "owner@example.com") {
        expect(context.childReads).not.toHaveBeenCalledWith(
          "recordingComments",
        );
      }
    },
  );

  it.each([
    {
      email: "owner@example.com",
      trashedAt: "2026-01-01T00:00:00Z",
      expiresAt: null,
    },
    {
      email: "owner@example.com",
      trashedAt: null,
      expiresAt: "2020-01-01T00:00:00Z",
    },
    { email: "viewer@example.com", trashedAt: null, expiresAt: null },
  ])(
    "keeps owner previews and restored viewer context: %j",
    async ({ email, ...settings }) => {
      context.email = email;
      Object.assign(context.recording!, settings);
      const screen = JSON.parse(await action.run({}));
      expect(screen.recording.id).toBe("rec-test");
      expect(screen.comments[0].content).toBe("Fake discussion");
    },
  );
});
