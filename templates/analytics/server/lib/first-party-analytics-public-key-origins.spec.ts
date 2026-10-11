import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const columns = {
    id: "id",
    ownerEmail: "ownerEmail",
    orgId: "orgId",
    publicKeyPrefix: "publicKeyPrefix",
    replayAllowedOrigins: "replayAllowedOrigins",
  };
  const row = {
    id: "apk-1",
    publicKeyPrefix: "anpk_safe",
    replayAllowedOrigins: JSON.stringify(["https://clips.agent-native.com"]),
  };
  const updatedRow = { ...row };
  const selectWhere = vi.fn();
  const updateWhere = vi.fn();
  const set = vi.fn();
  const returning = vi.fn();
  const db: Record<string, any> = {};
  db.transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback(db),
  );
  db.select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: (where: unknown) => {
        selectWhere(where);
        return { for: vi.fn(async () => [row]) };
      },
    })),
  }));
  db.update = vi.fn(() => ({
    set: (value: unknown) => {
      set(value);
      return {
        where: (where: unknown) => {
          updateWhere(where);
          return { returning: async () => returning() };
        },
      };
    },
  }));
  set.mockImplementation((value: Record<string, unknown>) => {
    Object.assign(updatedRow, value);
  });
  returning.mockImplementation(async () => [updatedRow]);
  return {
    columns,
    row,
    updatedRow,
    selectWhere,
    updateWhere,
    set,
    returning,
    db,
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: (...values: unknown[]) => ["and", ...values],
    eq: (column: unknown, value: unknown) => ["eq", column, value],
    getTableName: () => "session_recording_shares",
    isNull: (column: unknown) => ["isNull", column],
    or: (...values: unknown[]) => ["or", ...values],
  };
});
vi.mock("../db/index.js", () => ({
  getDb: () => state.db,
  schema: { analyticsPublicKeys: state.columns },
}));

const { updateAnalyticsPublicKeyOrigins } =
  await import("./first-party-analytics");

describe("updateAnalyticsPublicKeyOrigins", () => {
  beforeEach(() => {
    state.row.replayAllowedOrigins = JSON.stringify([
      "https://clips.agent-native.com",
    ]);
    Object.assign(state.updatedRow, state.row);
    state.selectWhere.mockClear();
    state.updateWhere.mockClear();
    state.set.mockClear();
    state.returning.mockClear();
  });

  it("appends unique origins transactionally and updates only the allowlist field", async () => {
    const result = await updateAnalyticsPublicKeyOrigins(
      { userEmail: "member@example.com", orgId: "org-1" },
      "apk-1",
      [
        "https://clips.agent-native.com",
        "https://beta.clips.agent-native.com",
        "https://beta.clips.agent-native.com",
      ],
    );

    const scopedKeyWhere = [
      "and",
      ["eq", "id", "apk-1"],
      [
        "or",
        ["eq", "orgId", "org-1"],
        [
          "and",
          ["eq", "ownerEmail", "member@example.com"],
          ["isNull", "orgId"],
        ],
      ],
    ];
    expect(state.selectWhere).toHaveBeenCalledWith(scopedKeyWhere);
    expect(state.updateWhere).toHaveBeenCalledWith(scopedKeyWhere);
    expect(state.set).toHaveBeenCalledWith({
      replayAllowedOrigins: JSON.stringify([
        "https://clips.agent-native.com",
        "https://beta.clips.agent-native.com",
      ]),
    });
    expect(result).toEqual({
      id: "apk-1",
      publicKeyPrefix: "anpk_safe",
      replayAllowedOrigins: [
        "https://clips.agent-native.com",
        "https://beta.clips.agent-native.com",
      ],
      addedOrigins: ["https://beta.clips.agent-native.com"],
      changed: true,
    });
  });

  it("fails closed instead of replacing an unreadable stored allowlist", async () => {
    state.row.replayAllowedOrigins = "[not valid JSON";

    await expect(
      updateAnalyticsPublicKeyOrigins(
        { userEmail: "member@example.com", orgId: "org-1" },
        "apk-1",
        ["https://beta.clips.agent-native.com"],
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(state.set).not.toHaveBeenCalled();
  });

  it("restricts an unrestricted key to the origins supplied on the first update", async () => {
    state.row.replayAllowedOrigins = JSON.stringify([]);
    Object.assign(state.updatedRow, state.row);

    const result = await updateAnalyticsPublicKeyOrigins(
      { userEmail: "member@example.com", orgId: "org-1" },
      "apk-1",
      ["https://beta.clips.agent-native.com"],
    );

    expect(state.set).toHaveBeenCalledWith({
      replayAllowedOrigins: JSON.stringify([
        "https://beta.clips.agent-native.com",
      ]),
    });
    expect(result?.replayAllowedOrigins).toEqual([
      "https://beta.clips.agent-native.com",
    ]);
  });
});
