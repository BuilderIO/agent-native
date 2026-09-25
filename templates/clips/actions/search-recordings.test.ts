import { beforeEach, describe, expect, it, vi } from "vitest";

const whereConditions = vi.hoisted(() => [] as unknown[]);
const tables = vi.hoisted(() => ({
  recordings: { trashedAt: "recordings.trashedAt" },
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
  sql: (strings: TemplateStringsArray) => ({
    kind: "sql",
    text: strings.join("?"),
  }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: () => makeQuery() }),
  schema: tables,
}));

vi.mock("../server/lib/agent-recording-access.js", () => ({
  agentRecordingAccessFilter: () => ({ kind: "access" }),
  isAgentRecordingCaller: () => false,
}));

import action from "./search-recordings";

describe("search-recordings", () => {
  beforeEach(() => {
    whereConditions.length = 0;
  });

  it("excludes trashed recordings from title, transcript, and comment matches", async () => {
    await action.run({ query: "roadmap", limit: 30 }, {
      userEmail: "viewer@example.com",
    } as never);

    expect(whereConditions).toHaveLength(3);
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
