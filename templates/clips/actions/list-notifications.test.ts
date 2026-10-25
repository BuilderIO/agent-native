import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  email: "viewer@example.com",
  recording: {
    id: "rec-test",
    title: "Fake recording",
    ownerEmail: "owner@example.com",
    password: null as string | null,
    expiresAt: null as string | null,
    trashedAt: null as string | null,
    enableComments: true,
  },
}));
const tables = vi.hoisted(() => ({
  recordings: {
    id: "id",
    title: "title",
    ownerEmail: "ownerEmail",
    password: "password",
    expiresAt: "expiresAt",
    trashedAt: "trashedAt",
    enableComments: "enableComments",
  },
  recordingShares: {},
  recordingComments: {
    recordingId: "recordingId",
    createdAt: "createdAt",
    mentionsJson: "mentionsJson",
  },
  recordingReactions: { recordingId: "recordingId", createdAt: "createdAt" },
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/sharing", () => ({ accessFilter: () => true }));
vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfiles: async () => new Map(),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => state.email,
  sameOwnerEmail: (
    a: string | null | undefined,
    b: string | null | undefined,
  ) => a?.toLowerCase() === b?.toLowerCase(),
}));
vi.mock("../server/lib/user-identities.js", () => ({
  profileNameFor: () => "Fake author",
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  or: (...conditions: unknown[]) => conditions,
  desc: vi.fn(),
  gte: vi.fn(),
  sql: vi.fn(),
  inArray: (column: string, values: string[]) => ({ column, values }),
}));
vi.mock("../server/db/index.js", () => ({
  schema: tables,
  getDb: () => ({
    select: (projection?: Record<string, string>) => {
      let table: unknown;
      const query = {
        from: (value: unknown) => {
          table = value;
          return query;
        },
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        then: (resolve: (rows: unknown[]) => unknown) => {
          const rows =
            table === tables.recordings
              ? [
                  projection
                    ? Object.fromEntries(
                        Object.entries(projection).map(([key, column]) => [
                          key,
                          state.recording[
                            column as keyof typeof state.recording
                          ],
                        ]),
                      )
                    : state.recording,
                ]
              : table === tables.recordingComments
                ? [
                    {
                      id: "comment-test",
                      recordingId: "rec-test",
                      content: "Fake discussion",
                      authorEmail: "author@example.com",
                      createdAt: new Date().toISOString(),
                      mentionsJson: JSON.stringify([
                        { email: "viewer@example.com" },
                      ]),
                    },
                  ]
                : [];
          return Promise.resolve(rows).then(resolve);
        },
      };
      return query;
    },
  }),
}));

import action from "./list-notifications";

describe("list-notifications recording lifecycle", () => {
  beforeEach(() => {
    state.email = "viewer@example.com";
    state.recording.trashedAt = null;
    state.recording.expiresAt = null;
    state.recording.password = null;
    state.recording.enableComments = true;
  });

  it("withholds a trashed recording's mention from a nonowner", async () => {
    state.recording.trashedAt = "2026-01-01T00:00:00Z";
    expect(await action.run({ days: 30, limit: 200 })).toEqual({
      items: [],
      count: 0,
    });
  });

  it.each([
    { email: "viewer@example.com", expectedCount: 0 },
    { email: "owner@example.com", expectedCount: 1 },
  ])(
    "applies comments-off visibility to notification history: %j",
    async ({ email, expectedCount }) => {
      state.email = email;
      state.recording.enableComments = false;
      const result = await action.run({ days: 30, limit: 200 });
      expect(result.count).toBe(expectedCount);
      expect(result.items.map((item) => item.preview)).toEqual(
        expectedCount ? ["Fake discussion"] : [],
      );
    },
  );

  it.each([
    { email: "owner@example.com", trashedAt: "2026-01-01T00:00:00Z" },
    { email: "viewer@example.com", trashedAt: null },
  ])(
    "preserves owner Trash and restored mentions: %j",
    async ({ email, trashedAt }) => {
      state.email = email;
      state.recording.trashedAt = trashedAt;
      const result = await action.run({ days: 30, limit: 200 });
      expect(result.items[0]?.preview).toBe("Fake discussion");
      expect(result.count).toBe(1);
    },
  );

  it.each(["viewer@example.com", "owner@example.com"])(
    "preserves expiry filtering for %s",
    async (email) => {
      state.email = email;
      state.recording.expiresAt = "2020-01-01T00:00:00Z";
      expect(await action.run({ days: 30, limit: 200 })).toEqual({
        items: [],
        count: 0,
      });
    },
  );
});
