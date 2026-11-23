import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCountWhere = vi.hoisted(() => vi.fn(async () => [{ count: 3 }]));
const mockMeetingWhere = vi.hoisted(() =>
  vi.fn(async () => [{ id: "meeting-rec-1" }, { id: null }]),
);
const mockRows = vi.hoisted(() => vi.fn(async () => []));
const mockRowsWhere = vi.hoisted(() =>
  vi.fn(() => ({
    orderBy: vi.fn(() => ({
      limit: vi.fn(() => ({ offset: mockRows })),
    })),
  })),
);
const mockAuxWhere = vi.hoisted(() => vi.fn(async () => []));
const mockGroupedWhere = vi.hoisted(() =>
  vi.fn(() => ({ groupBy: vi.fn(async () => []) })),
);
const mockTables = vi.hoisted(() => ({
  meetings: {},
  recordings: {},
  recordingTags: {},
  recordingViews: {},
  recordingAgentViews: {},
  recordingViewers: {},
  recordingTranscripts: {},
}));
const mockFrom = vi.hoisted(() =>
  vi.fn((table: unknown) => {
    if (table === mockTables.meetings) {
      return { where: mockMeetingWhere };
    }
    if (table === mockTables.recordings) {
      return {
        where: mockCountWhere,
        leftJoin: () => ({ where: mockRowsWhere }),
      };
    }
    if (table === mockTables.recordingTags) {
      return { where: mockAuxWhere };
    }
    if (
      table === mockTables.recordingViews ||
      table === mockTables.recordingAgentViews ||
      table === mockTables.recordingViewers
    ) {
      return { where: mockGroupedWhere };
    }
    return { where: mockCountWhere };
  }),
);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({ from: mockFrom })),
}));
const makeLazyDbProxy = vi.hoisted(
  () =>
    function makeLazyDbProxy(
      realDb: any,
      chain: Array<{ prop: string | symbol; args?: any[] }> = [],
    ): any {
      return new Proxy(function () {} as any, {
        get(_target, prop) {
          if (prop === "then" || prop === "catch" || prop === "finally") {
            const promise = Promise.resolve().then(() => {
              let result: any = realDb;
              for (const step of chain) {
                const value = result[step.prop];
                result =
                  typeof value === "function"
                    ? value.apply(result, step.args)
                    : value;
              }
              return result;
            });
            return (promise as any)[prop].bind(promise);
          }
          if (prop === "getSQL" || prop === "shouldOmitSQLParens") {
            throw new Error("unresolved query chain");
          }
          return makeLazyDbProxy(realDb, [...chain, { prop }]);
        },
        apply(_target, _thisArg, args) {
          const last = chain[chain.length - 1];
          return makeLazyDbProxy(realDb, [
            ...chain.slice(0, -1),
            { prop: last!.prop, args },
          ]);
        },
      });
    },
);
const mockNot = vi.hoisted(() =>
  vi.fn((value: unknown) => ({ kind: "not", value })),
);
const mockOwnerEmailMatches = vi.hoisted(() =>
  vi.fn((column: unknown, email: string) => ({
    kind: "owner-email",
    column,
    email,
  })),
);

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "viewer@example.com",
}));

vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfiles: async () => new Map(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ kind: "access-filter" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  asc: vi.fn(),
  desc: vi.fn(),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  inArray: vi.fn(),
  isNotNull: (column: unknown) => ({ kind: "is-not-null", column }),
  isNull: (column: unknown) => ({ kind: "is-null", column }),
  not: (...args: unknown[]) => mockNot(...args),
  notInArray: (column: unknown, values: unknown) => {
    typeof (values as { getSQL?: unknown }).getSQL;
    return { kind: "not-in-array", column, values };
  },
  sql: (strings: TemplateStringsArray) => ({
    kind: "sql",
    text: strings.join("?"),
  }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => makeLazyDbProxy(mockDb),
  schema: {
    meetings: Object.assign(mockTables.meetings, {
      recordingId: "meetings.recordingId",
    }),
    recordings: Object.assign(mockTables.recordings, {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      organizationId: "recordings.organizationId",
      folderId: "recordings.folderId",
      archivedAt: "recordings.archivedAt",
      trashedAt: "recordings.trashedAt",
      madeBy: "recordings.madeBy",
    }),
    recordingShares: "recordingShares",
    recordingContentBindings: {
      recordingId: "recordingContentBindings.recordingId",
      origin: "recordingContentBindings.origin",
    },
    recordingTags: mockTables.recordingTags,
    recordingViews: Object.assign(mockTables.recordingViews, {
      recordingId: "recordingViews.recordingId",
    }),
    recordingAgentViews: Object.assign(mockTables.recordingAgentViews, {
      recordingId: "recordingAgentViews.recordingId",
    }),
    recordingViewers: Object.assign(mockTables.recordingViewers, {
      recordingId: "recordingViewers.recordingId",
    }),
    recordingTranscripts: Object.assign(mockTables.recordingTranscripts, {
      recordingId: "recordingTranscripts.recordingId",
    }),
  },
}));

const mockFilterLibraryRecordings = vi.hoisted(() =>
  vi.fn(async () => ({
    ids: [],
    counts: { matching: 0, hiddenByPinned: 0, options: {} },
    tags: [],
  })),
);

vi.mock("../server/lib/library-filter.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/library-filter.js")>()),
  filterLibraryRecordings: mockFilterLibraryRecordings,
}));

vi.mock("../server/lib/recordings.js", () => ({
  countedViewCondition: () => ({ kind: "counted-view-condition" }),
  getActiveOrganizationId: async () => "org_123",
  ownerEmailMatches: (column: unknown, email: string) =>
    mockOwnerEmailMatches(column, email),
  parseSpaceIds: vi.fn(),
}));

import {
  activeUploadFromContent,
  uploadedFromContent,
} from "../server/lib/content-uploads.js";
import action, {
  mergeViewCounts,
  resolveListRecordingMedia,
} from "./list-recordings";

describe("list-recordings view counts", () => {
  it("counts one view per logged session, not per viewer", () => {
    expect(
      mergeViewCounts(
        [{ recordingId: "rec-1", count: 3 }],
        [{ recordingId: "rec-1", count: 11 }],
      ),
    ).toEqual({ "rec-1": 11 });
  });

  it("falls back to counted viewers for pre-migration clips", () => {
    expect(mergeViewCounts([{ recordingId: "rec-1", count: 5 }], [])).toEqual({
      "rec-1": 5,
    });
  });

  it("never reports fewer views than counted viewers", () => {
    expect(
      mergeViewCounts(
        [{ recordingId: "rec-1", count: 9 }],
        [{ recordingId: "rec-1", count: 2 }],
      ),
    ).toEqual({ "rec-1": 9 });
  });

  it("normalizes driver-provided string counts", () => {
    expect(
      mergeViewCounts(
        [{ recordingId: "rec-1", count: "2" }],
        [{ recordingId: "rec-1", count: "6" }],
      ),
    ).toEqual({ "rec-1": 6 });
  });
});

describe("list-recordings editor media", () => {
  it("coerces the editor media flag from GET query parameters", () => {
    expect(action.schema.parse({ includeMedia: "true" }).includeMedia).toBe(
      true,
    );
  });

  it("keeps playable media out of normal library rows", () => {
    expect(
      resolveListRecordingMedia(
        { id: "rec-1", videoUrl: "/api/video/rec-1", videoFormat: "mp4" },
        false,
      ),
    ).toEqual({ videoUrl: null, videoFormat: null });
  });

  it("returns a same-origin media route for editor sources", () => {
    expect(
      resolveListRecordingMedia(
        {
          id: "rec-1",
          videoUrl: "https://cdn.example.test/rec-1.webm",
          videoFormat: "webm",
        },
        true,
      ),
    ).toEqual({ videoUrl: "/api/video/rec-1", videoFormat: "webm" });
  });

  it("drops unsupported media formats from editor rows", () => {
    expect(
      resolveListRecordingMedia(
        { id: "rec-1", videoUrl: "/api/video/rec-1", videoFormat: "mov" },
        true,
      ),
    ).toEqual({ videoUrl: "/api/video/rec-1", videoFormat: null });
  });
});

describe("list-recordings thumbnails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns static and animated thumbnails through same-origin proxy routes", async () => {
    mockRows.mockResolvedValueOnce([
      {
        recording: {
          id: "rec/1",
          title: "Private clip",
          titleSource: "default",
          sourceAppName: null,
          sourceWindowTitle: null,
          description: "",
          thumbnailUrl: "https://private-bucket.example/thumb.jpg",
          animatedThumbnailUrl: "https://private-bucket.example/preview.gif",
          durationMs: 1000,
          editsJson: null,
          status: "ready",
          uploadProgress: null,
          failureReason: null,
          visibility: "private",
          hasPassword: 0,
          expiresAt: null,
          ownerEmail: "viewer@example.com",
          folderId: null,
          spaceIds: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          archivedAt: null,
          trashedAt: null,
          hasAudio: false,
          hasCamera: false,
          width: 1280,
          height: 720,
          videoUrl: null,
          videoFormat: null,
        },
        transcriptStatus: null,
        transcriptHasText: 0,
      },
    ]);

    const result = await action.run(action.schema.parse({ view: "library" }));

    expect(result.recordings[0]).toMatchObject({
      thumbnailUrl: "/api/thumbnail/rec%2F1",
      animatedThumbnailUrl: "/api/thumbnail/rec%2F1?animated=1",
    });
    expect(result.recordings[0]?.thumbnailUrl).not.toContain(
      "private-bucket.example",
    );
    expect(result.recordings[0]?.animatedThumbnailUrl).not.toContain(
      "private-bucket.example",
    );
  });
});

describe("list-recordings shared view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns accessible clips owned by someone else", async () => {
    const parsed = action.schema.parse({
      view: "shared",
      countOnly: true,
    });

    const result = await action.run(parsed);

    expect(mockOwnerEmailMatches).toHaveBeenCalledWith(
      "recordings.ownerEmail",
      "viewer@example.com",
    );
    expect(mockNot).toHaveBeenCalledWith({
      kind: "owner-email",
      column: "recordings.ownerEmail",
      email: "viewer@example.com",
    });
    expect(mockMeetingWhere).toHaveBeenCalledWith({
      kind: "is-not-null",
      column: "meetings.recordingId",
    });
    expect(mockCountWhere).toHaveBeenCalledWith({
      kind: "and",
      conditions: expect.arrayContaining([
        { kind: "access-filter" },
        {
          kind: "not",
          value: {
            kind: "owner-email",
            column: "recordings.ownerEmail",
            email: "viewer@example.com",
          },
        },
        {
          kind: "is-null",
          column: "recordings.archivedAt",
        },
        {
          kind: "is-null",
          column: "recordings.trashedAt",
        },
      ]),
    });
    expect(result).toEqual({ recordings: [], total: 3 });
  });

  it("excludes meeting recordings via a database-side subquery, not a materialized id array", async () => {
    const parsed = action.schema.parse({
      view: "shared",
      countOnly: true,
    });

    await action.run(parsed);

    const meetingQueryResult = mockMeetingWhere.mock.results[0]?.value;
    expect(meetingQueryResult).toBeDefined();
    expect(Array.isArray(meetingQueryResult)).toBe(false);

    expect(mockCountWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          {
            kind: "not-in-array",
            column: "recordings.id",
            values: meetingQueryResult,
          },
        ]),
      }),
    );
  });
});

describe.each([
  {
    view: "archive" as const,
    statusFilter: { kind: "is-not-null", column: "recordings.archivedAt" },
  },
  {
    view: "trash" as const,
    statusFilter: { kind: "is-not-null", column: "recordings.trashedAt" },
  },
])("list-recordings $view count", ({ view, statusFilter }) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the count used by the lifecycle sidebar", async () => {
    const result = await action.run(
      action.schema.parse({ view, countOnly: true }),
    );

    expect(mockCountWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          { kind: "access-filter" },
          statusFilter,
        ]),
      }),
    );
    expect(result).toEqual({ recordings: [], total: 3 });
  });
});

describe("list-recordings folder scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes foldered recordings from the library root", async () => {
    const parsed = action.schema.parse({
      view: "library",
      countOnly: true,
    });

    await action.run(parsed);

    expect(mockCountWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          {
            kind: "is-null",
            column: "recordings.folderId",
          },
        ]),
      }),
    );
  });

  it("keeps foldered recordings scoped to the requested folder", async () => {
    const parsed = action.schema.parse({
      view: "library",
      folderId: "folder_1",
      countOnly: true,
    });

    await action.run(parsed);

    expect(mockCountWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          {
            kind: "eq",
            column: "recordings.folderId",
            value: "folder_1",
          },
        ]),
      }),
    );
  });
});

describe("list-recordings made by", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps only recordings a person or an agent made", async () => {
    await action.run(
      action.schema.parse({
        view: "library",
        madeBy: "agent",
        countOnly: true,
      }),
    );

    expect(mockCountWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          { kind: "eq", column: "recordings.madeBy", value: "agent" },
        ]),
      }),
    );
  });

  it("refuses anything but person or agent", () => {
    expect(action.schema.safeParse({ madeBy: "robot" }).success).toBe(false);
  });

  it("returns who made each recording, and null where it wasn't recorded", async () => {
    const recording = {
      id: "rec-1",
      title: "Agent upload",
      titleSource: "default",
      sourceAppName: null,
      sourceWindowTitle: null,
      description: "",
      thumbnailUrl: null,
      animatedThumbnailUrl: null,
      durationMs: 1000,
      editsJson: null,
      status: "ready",
      uploadProgress: null,
      failureReason: null,
      visibility: "private",
      madeBy: "agent",
      madeByAgent: "Claude",
      hasPassword: 0,
      expiresAt: null,
      ownerEmail: "viewer@example.com",
      folderId: null,
      spaceIds: null,
      createdAt: "2026-11-20T00:00:00.000Z",
      updatedAt: "2026-11-20T00:00:00.000Z",
      archivedAt: null,
      trashedAt: null,
      hasAudio: false,
      hasCamera: false,
      width: 1280,
      height: 720,
      videoUrl: null,
      videoFormat: null,
    };
    mockRows.mockResolvedValueOnce([
      { recording, transcriptStatus: null, transcriptHasText: 0 },
      {
        recording: {
          ...recording,
          id: "rec-old",
          madeBy: null,
          madeByAgent: null,
        },
        transcriptStatus: null,
        transcriptHasText: 0,
      },
    ]);

    const result = await action.run(action.schema.parse({ view: "library" }));

    expect(result.recordings).toEqual([
      expect.objectContaining({
        id: "rec-1",
        madeBy: "agent",
        madeByAgent: "Claude",
      }),
      expect.objectContaining({
        id: "rec-old",
        madeBy: null,
        madeByAgent: null,
      }),
    ]);
  });
});

describe("list-recordings Library source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function countConditions(args: Record<string, unknown>) {
    await action.run(
      action.schema.parse({ view: "library", countOnly: true, ...args }),
    );
    const [where] = mockCountWhere.mock.calls[0] as unknown as [
      { conditions: unknown[] },
    ];
    return where.conditions;
  }

  it("leaves Content uploads out of Library by default", async () => {
    const conditions = await countConditions({});
    expect(conditions).toContainEqual({
      kind: "not",
      value: uploadedFromContent(),
    });
    expect(conditions).not.toContainEqual(activeUploadFromContent());
  });

  it("lists only Content uploads when the source asks for them", async () => {
    const conditions = await countConditions({ source: "content" });
    expect(conditions).toContainEqual(activeUploadFromContent());
    expect(conditions).not.toContainEqual({
      kind: "not",
      value: uploadedFromContent(),
    });
  });

  it("keeps Library's own list to recordings outside folders", async () => {
    const conditions = await countConditions({});
    expect(conditions).toContainEqual({
      kind: "is-null",
      column: "recordings.folderId",
    });
  });

  it.each(["content", "all"])(
    "looks inside folders when the source is %s",
    async (source) => {
      const conditions = await countConditions({ source });
      expect(conditions).not.toContainEqual({
        kind: "is-null",
        column: "recordings.folderId",
      });
    },
  );

  it("refuses a filter with a rule it can't read", async () => {
    await expect(
      action.run(
        action.schema.parse({
          view: "library",
          filters: "r=transcript:is_chekced",
        }),
      ),
    ).rejects.toThrow("r=transcript:is_chekced");
    expect(mockCountWhere).not.toHaveBeenCalled();
  });

  it("counts the default view's choices inside folders too", async () => {
    await action.run(
      action.schema.parse({ view: "library", countOnly: true, filters: "" }),
    );
    const [options] = mockFilterLibraryRecordings.mock.calls[0] as unknown as [
      { where: unknown[]; listWithin: unknown },
    ];
    const outsideFolders = { kind: "is-null", column: "recordings.folderId" };
    expect(options.where).not.toContainEqual(outsideFolders);
    expect(options.listWithin).toEqual(outsideFolders);
  });

  it("lists both kinds when the source is all", async () => {
    const conditions = await countConditions({ source: "all" });
    expect(conditions).not.toContainEqual(activeUploadFromContent());
    expect(conditions).not.toContainEqual({
      kind: "not",
      value: uploadedFromContent(),
    });
  });
});

describe("list-recordings search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches titles, descriptions, and transcripts case-insensitively", async () => {
    await action.run(
      action.schema.parse({
        view: "library",
        search: "  ONBOARDING  ",
        countOnly: true,
      }),
    );

    const whereArg = mockCountWhere.mock.calls[0]?.[0] as {
      conditions: Array<{ kind: string; text?: string }>;
    };
    const searchSql = whereArg.conditions.find(
      (c) => c.kind === "sql" && c.text?.includes("LIKE"),
    );
    expect(searchSql?.text).toContain("lower(");
    expect(searchSql?.text).toContain("recording_id");
    expect(whereArg.conditions).not.toContainEqual({
      kind: "is-null",
      column: "recordings.folderId",
    });
  });

  it("keeps root folderId IS NULL scope when searching screenshots (kind=image)", async () => {
    await action.run(
      action.schema.parse({
        view: "library",
        kind: "image",
        search: "onboarding",
        countOnly: true,
      }),
    );

    const whereArg = mockCountWhere.mock.calls[0]?.[0] as {
      conditions: Array<{ kind: string; column?: string }>;
    };
    expect(whereArg.conditions).toContainEqual({
      kind: "is-null",
      column: "recordings.folderId",
    });
  });

  it("points agents at navigate for showing filtered Library results", () => {
    expect(action.tool.description).toMatch(/navigate/i);
    expect(action.tool.description).toMatch(/search/i);
  });
});
