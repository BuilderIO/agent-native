import { beforeEach, describe, expect, it, vi } from "vitest";

const whereConditions = vi.hoisted(() => [] as unknown[]);
const selectedFields = vi.hoisted(() => [] as Record<string, unknown>[]);
const tables = vi.hoisted(() => ({
  recordings: {
    trashedAt: "recordings.trashedAt",
    ownerEmail: "recordings.ownerEmail",
  },
  recordingShares: {},
  recordingViewers: {},
  recordingTranscripts: {
    recordingId: "recordingTranscripts.recordingId",
    fullText: "recordingTranscripts.fullText",
    segmentsJson: "recordingTranscripts.segmentsJson",
  },
  recordingComments: {
    recordingId: "recordingComments.recordingId",
    content: "recordingComments.content",
    videoTimestampMs: "recordingComments.videoTimestampMs",
  },
}));

const makeQuery = vi.hoisted(() => {
  const create = (): any => ({
    from: () => create(),
    innerJoin: () => create(),
    where: (condition: unknown) => {
      whereConditions.push(condition);
      return create();
    },
    limit: () => create(),
    then: (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve([]).then(resolve),
  });
  return create;
});

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
  embedApp: () => ({}),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  isNull: (column: unknown) => ({ kind: "is-null", column }),
  or: (...conditions: unknown[]) => ({ kind: "or", conditions }),
  sql: (strings: TemplateStringsArray) => ({
    kind: "sql",
    text: strings.join("?"),
  }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: (fields: Record<string, unknown>) => {
      selectedFields.push(fields);
      return makeQuery();
    },
  }),
  schema: tables,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => null,
}));

vi.mock("../server/lib/recordings.js", () => ({
  ownerEmailMatches: (column: unknown, email: string) => ({
    kind: "owner-email",
    column,
    email,
  }),
}));

vi.mock("../server/lib/agent-recording-access.js", () => ({
  agentRecordingAccessFilter: () => ({ kind: "access" }),
  isAgentRecordingCaller: () => false,
}));

import action from "./search-recordings";

describe("search-recordings", () => {
  beforeEach(() => {
    whereConditions.length = 0;
    selectedFields.length = 0;
  });

  it("returns Trash status and scopes trashed matches to their owner", async () => {
    await action.run({ query: "roadmap", limit: 30 }, {
      userEmail: "owner@example.com",
    } as never);

    expect(selectedFields).toHaveLength(3);
    expect(
      selectedFields.every(
        (fields) => fields.trashedAt === tables.recordings.trashedAt,
      ),
    ).toBe(true);
    expect(whereConditions).toHaveLength(3);
    expect(
      whereConditions.every((condition: any) =>
        condition.conditions.some(
          (nested: any) =>
            nested.kind === "or" &&
            nested.conditions.some(
              (part: any) =>
                part.kind === "owner-email" &&
                part.column === tables.recordings.ownerEmail &&
                part.email === "owner@example.com",
            ),
        ),
      ),
    ).toBe(true);
  });

  it("keeps Trash out of agent search without a caller identity", async () => {
    await action.run({ query: "roadmap", limit: 30 }, {} as never);

    expect(
      whereConditions.every((condition: any) =>
        condition.conditions.some(
          (nested: any) =>
            nested.kind === "is-null" &&
            nested.column === tables.recordings.trashedAt,
        ),
      ),
    ).toBe(true);
  });
});
