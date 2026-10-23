import { beforeEach, describe, expect, it, vi } from "vitest";

const whereConditions = vi.hoisted(() => [] as unknown[]);
const selectedFields = vi.hoisted(() => [] as Record<string, unknown>[]);
const searchRows = vi.hoisted(() => ({
  comments: [] as Record<string, unknown>[],
}));
const tables = vi.hoisted(() => ({
  recordings: {
    id: "recordings.id",
    title: "recordings.title",
    description: "recordings.description",
    trashedAt: "recordings.trashedAt",
    ownerEmail: "recordings.ownerEmail",
    enableComments: "recordings.enableComments",
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
  const matches = (row: Record<string, unknown>, condition: any): boolean => {
    if (condition.kind === "and")
      return condition.conditions.every((part: unknown) => matches(row, part));
    if (condition.kind === "or")
      return condition.conditions.some((part: unknown) => matches(row, part));
    if (condition.kind === "eq")
      return row[condition.column] === condition.value;
    if (condition.kind === "is-null") return row[condition.column] == null;
    if (condition.kind === "owner-email")
      return (
        String(row[condition.column]).toLowerCase() ===
        condition.email.toLowerCase()
      );
    if (condition.kind === "access") return true;
    if (condition.kind === "sql") {
      const column = condition.values[0];
      const pattern = condition.values[1];
      return (
        typeof row[column] === "string" &&
        String(row[column])
          .toLowerCase()
          .includes(String(pattern).replace(/^%|%$/g, ""))
      );
    }
    throw new Error(`Unsupported query condition: ${condition.kind}`);
  };
  const create = (fields: Record<string, unknown>): any => {
    let table: unknown;
    let filter: any;
    let limit = Infinity;
    const query = {
      from: (value: unknown) => {
        table = value;
        return query;
      },
      innerJoin: () => query,
      where: (condition: unknown) => {
        whereConditions.push(condition);
        filter = condition;
        return query;
      },
      limit: (value: number) => {
        limit = value;
        return query;
      },
      then: (resolve: (value: unknown[]) => unknown) =>
        Promise.resolve(
          table === tables.recordingComments
            ? searchRows.comments
                .filter((row) => matches(row, filter))
                .slice(0, limit)
                .map((row) =>
                  Object.fromEntries(
                    Object.entries(fields).map(([key, column]) => [
                      key,
                      row[String(column)],
                    ]),
                  ),
                )
            : [],
        ).then(resolve),
    };
    return query;
  };
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
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    text: strings.join("?"),
    values,
  }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: (fields: Record<string, unknown>) => {
      selectedFields.push(fields);
      return makeQuery(fields);
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
    searchRows.comments = [];
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

  it.each([
    { email: "viewer@example.com", enableComments: false, visible: false },
    { email: "owner@example.com", enableComments: false, visible: true },
    { email: "viewer@example.com", enableComments: true, visible: true },
  ])(
    "applies comment visibility before returning search snippets: %j",
    async ({ email, enableComments, visible }) => {
      searchRows.comments = [
        {
          "recordings.id": "rec-test",
          "recordings.title": "Fake recording",
          "recordings.description": "Fake description",
          "recordings.ownerEmail": "owner@example.com",
          "recordings.trashedAt": null,
          "recordings.enableComments": enableComments,
          "recordingComments.recordingId": "rec-test",
          "recordingComments.content": "A fake needle discussion",
          "recordingComments.videoTimestampMs": 12000,
        },
      ];
      const result = await action.run({ query: "needle", limit: 30 }, {
        userEmail: email,
      } as never);
      expect(
        result.results.map((row) => ({ id: row.id, snippet: row.snippet })),
      ).toEqual(
        visible
          ? [{ id: "rec-test", snippet: "A fake needle discussion" }]
          : [],
      );
    },
  );
});
