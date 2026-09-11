import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getRequestOrgId: vi.fn(),
}));

const tables = vi.hoisted(() => ({
  recordingShares: {
    id: "recording_shares.id",
    resourceId: "recording_shares.resource_id",
    principalType: "recording_shares.principal_type",
    principalId: "recording_shares.principal_id",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
  or: (...conditions: unknown[]) => ({ type: "or", conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: (...args: unknown[]) =>
    mocks.getRequestUserEmail(...args),
  getRequestOrgId: (...args: unknown[]) => mocks.getRequestOrgId(...args),
}));

vi.mock("../db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: tables,
}));

import { hasExplicitRecordingShare } from "./recording-share-grant.js";

function createDb(rows: unknown[]) {
  const calls: { where?: unknown } = {};
  const builder = {
    from: () => builder,
    where(condition: unknown) {
      calls.where = condition;
      return builder;
    },
    limit: () => Promise.resolve(rows),
  };
  const db = { select: vi.fn(() => builder) };
  return { db, calls };
}

const base = {
  recordingId: "rec-1",
  role: "viewer" as const,
  visibility: "public" as const,
  hasPassword: false,
};

describe("hasExplicitRecordingShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    mocks.getRequestOrgId.mockReturnValue(undefined);
    const { db } = createDb([]);
    mocks.getDb.mockReturnValue(db);
  });

  it("treats the owner as granted without querying shares", async () => {
    await expect(
      hasExplicitRecordingShare({ ...base, role: "owner" }),
    ).resolves.toBe(true);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each(["private", "org"] as const)(
    "does not look for a public share grant on %s recordings",
    async (visibility) => {
      await expect(
        hasExplicitRecordingShare({ ...base, visibility }),
      ).resolves.toBe(false);
      expect(mocks.getDb).not.toHaveBeenCalled();
    },
  );

  it("grants agent callers password-less public clips", async () => {
    await expect(
      hasExplicitRecordingShare({ ...base, isAgentCaller: true }),
    ).resolves.toBe(true);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("still requires a share row for an agent caller on a passworded clip", async () => {
    await expect(
      hasExplicitRecordingShare({
        ...base,
        hasPassword: true,
        isAgentCaller: true,
        userEmail: "viewer@example.com",
      }),
    ).resolves.toBe(false);
    expect(mocks.getDb).toHaveBeenCalled();
  });

  it("returns false without a query when there is no principal to match", async () => {
    await expect(
      hasExplicitRecordingShare({ ...base, userEmail: null, orgId: null }),
    ).resolves.toBe(false);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("matches a share row by lowercased user email or org id", async () => {
    const { db, calls } = createDb([{ id: "share-1" }]);
    mocks.getDb.mockReturnValue(db);

    await expect(
      hasExplicitRecordingShare({
        ...base,
        userEmail: "  Viewer@Example.com ",
        orgId: "org-1",
      }),
    ).resolves.toBe(true);

    expect(calls.where).toEqual({
      type: "and",
      conditions: [
        {
          type: "eq",
          left: tables.recordingShares.resourceId,
          right: "rec-1",
        },
        {
          type: "or",
          conditions: [
            {
              type: "and",
              conditions: [
                {
                  type: "eq",
                  left: tables.recordingShares.principalType,
                  right: "user",
                },
                expect.objectContaining({
                  values: [
                    tables.recordingShares.principalId,
                    "viewer@example.com",
                  ],
                }),
              ],
            },
            {
              type: "and",
              conditions: [
                {
                  type: "eq",
                  left: tables.recordingShares.principalType,
                  right: "org",
                },
                {
                  type: "eq",
                  left: tables.recordingShares.principalId,
                  right: "org-1",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("falls back to the ambient request context when the caller omits it", async () => {
    mocks.getRequestUserEmail.mockReturnValue("Ambient@Example.com");
    mocks.getRequestOrgId.mockReturnValue(null);
    const { db } = createDb([{ id: "share-1" }]);
    mocks.getDb.mockReturnValue(db);

    await expect(hasExplicitRecordingShare(base)).resolves.toBe(true);
    expect(mocks.getRequestUserEmail).toHaveBeenCalled();
  });
});
