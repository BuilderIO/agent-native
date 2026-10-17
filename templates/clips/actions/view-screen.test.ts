import { beforeEach, describe, expect, it, vi } from "vitest";

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
    key === "navigation" ? { view: "library" } : null,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "viewer@example.com",
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
