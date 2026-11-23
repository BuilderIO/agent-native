import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entries: new Map<string, unknown>(),
  details: vi.fn(),
  authorize: vi.fn(),
  allowed: true,
  orgId: "org-a",
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSettingEntry: async (email: string, key: string) => {
    const value = mocks.entries.get(`${email}:${key}`);
    return value === undefined ? { found: false } : { found: true, value };
  },
  mutateUserSetting: async (
    email: string,
    key: string,
    update: (value: unknown) => unknown,
    options: { validateStoredValue: (value: unknown) => void },
  ) => {
    const entryKey = `${email}:${key}`;
    const current = mocks.entries.get(entryKey) ?? null;
    if (current !== null) options.validateStoredValue(current);
    const next = update(current);
    mocks.entries.set(entryKey, next);
    return next;
  },
}));
vi.mock("../lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({
    ownerEmail: "person@example.test",
    orgId: mocks.orgId,
  }),
  currentWorkspaceCapabilities: async () => ({ allows: () => mocks.allowed }),
}));
vi.mock("./data-table-details.js", () => ({
  getDataTableDetails: mocks.details,
  authorizeFavoriteTables: mocks.authorize,
}));

import { listDataFavorites, setDataFavorite } from "./data-favorites.js";

beforeEach(() => {
  mocks.entries.clear();
  mocks.allowed = true;
  mocks.orgId = "org-a";
  mocks.details.mockReset();
  mocks.authorize.mockReset();
  mocks.authorize.mockImplementation(async (refs) =>
    refs.map((ref: { tableId: string }) => ref.tableId.split(":").at(-1)),
  );
  mocks.details.mockImplementation(async ({ connectionId, tableId }) => ({
    connectionId,
    table: { name: tableId.split(":").at(-1) },
  }));
});

it("persists independent exact tables and removes only the requested favorite", async () => {
  const a = { connectionId: "one", tableId: "table:p:d:a" };
  const b = { connectionId: "two", tableId: "table:p:d:b" };
  await setDataFavorite({ ...a, favorited: true }, "frontend");
  await setDataFavorite({ ...b, favorited: true }, "frontend");
  expect((await listDataFavorites("frontend")).favorites).toEqual([
    { ...b, name: "b" },
    { ...a, name: "a" },
  ]);
  await setDataFavorite({ ...a, favorited: false }, "frontend");
  expect((await listDataFavorites("frontend")).favorites).toEqual([
    { ...b, name: "b" },
  ]);
});

it("does not report an inaccessible table or corrupt stored value as an empty list", async () => {
  const a = { connectionId: "one", tableId: "table:p:d:a" };
  await setDataFavorite({ ...a, favorited: true }, "frontend");
  mocks.authorize.mockRejectedValue(new Error("access revoked"));
  await expect(listDataFavorites("frontend")).rejects.toThrow("access revoked");
  const key = [...mocks.entries.keys()][0];
  if (key === undefined) throw new Error("Favorite setting was not written");
  mocks.entries.set(key, { favorites: "corrupt" });
  await expect(listDataFavorites("frontend")).rejects.toThrow();
  await expect(
    setDataFavorite({ ...a, favorited: false }, "frontend"),
  ).rejects.toThrow();
});

it("separates organizations and rejects list and mutation when browser access is denied", async () => {
  const ref = { connectionId: "one", tableId: "table:p:d:a" };
  await setDataFavorite({ ...ref, favorited: true }, "frontend");
  mocks.orgId = "org-b";
  expect((await listDataFavorites("frontend")).favorites).toEqual([]);
  mocks.orgId = "org-a";
  mocks.allowed = false;
  await expect(listDataFavorites("frontend")).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(
    setDataFavorite({ ...ref, favorited: false }, "frontend"),
  ).rejects.toMatchObject({ statusCode: 403 });
  mocks.allowed = true;
  expect((await listDataFavorites("frontend")).favorites).toHaveLength(1);
});

it("report 807: omits a deleted connection but preserves other favorites and failures", async () => {
  const a = { connectionId: "one", tableId: "table:p:d:a" };
  const b = { connectionId: "two", tableId: "table:p:d:b" };
  await setDataFavorite({ ...a, favorited: true }, "frontend");
  await setDataFavorite({ ...b, favorited: true }, "frontend");
  mocks.authorize.mockImplementation(async (refs) => {
    if (refs[0].connectionId === "one")
      throw { errorCode: "data_connection_not_found" };
    return refs.map((ref: { tableId: string }) =>
      ref.tableId.split(":").at(-1),
    );
  });
  expect((await listDataFavorites("frontend")).favorites).toEqual([
    { ...b, name: "b" },
  ]);
  for (const errorCode of ["data_table_access_denied", "internal_error"]) {
    mocks.authorize.mockRejectedValue({ errorCode });
    await expect(listDataFavorites("frontend")).rejects.toMatchObject({
      errorCode,
    });
  }
});
