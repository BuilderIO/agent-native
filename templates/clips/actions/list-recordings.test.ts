import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCountWhere = vi.hoisted(() => vi.fn(async () => [{ count: 3 }]));
const mockMeetingWhere = vi.hoisted(() =>
  vi.fn(() => ({ kind: "meeting-recording-subquery" })),
);
const mockFrom = vi.hoisted(() =>
  vi.fn((table: unknown) => {
    if (typeof table === "object" && table !== null && "recordingId" in table) {
      return { where: mockMeetingWhere };
    }
    return { where: mockCountWhere };
  }),
);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({ from: mockFrom })),
}));
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
  notInArray: (column: unknown, values: unknown) => ({
    kind: "not-in-array",
    column,
    values,
  }),
  sql: (strings: TemplateStringsArray) => ({
    kind: "sql",
    text: strings.join("?"),
  }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    meetings: {
      recordingId: "meetings.recordingId",
    },
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      organizationId: "recordings.organizationId",
      archivedAt: "recordings.archivedAt",
      trashedAt: "recordings.trashedAt",
    },
    recordingShares: "recordingShares",
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  getActiveOrganizationId: async () => "org_123",
  ownerEmailMatches: (column: unknown, email: string) =>
    mockOwnerEmailMatches(column, email),
  parseSpaceIds: vi.fn(),
}));

import action from "./list-recordings";

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
});
