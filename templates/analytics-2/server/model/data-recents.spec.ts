import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entries: new Map<string, unknown>(),
  orgId: "org-a",
  allowed: true,
  authorize: vi.fn(),
  details: vi.fn(),
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
import { listDataRecents, touchDataRecent } from "./data-recents.js";

beforeEach(() => {
  mocks.entries.clear();
  mocks.orgId = "org-a";
  mocks.allowed = true;
  mocks.details.mockReset().mockResolvedValue({});
  mocks.authorize
    .mockReset()
    .mockImplementation(async (refs) =>
      refs.map((ref: { tableId: string }) => ref.tableId),
    );
});

it("report 1794912417.197639 and 807: persists recent tables in last-opened order per workspace", async () => {
  const a = { connectionId: "one", tableId: "table:a" };
  const b = { connectionId: "two", tableId: "table:b" };
  await touchDataRecent(a, "frontend");
  await touchDataRecent(b, "frontend");
  await touchDataRecent(a, "frontend");
  expect((await listDataRecents("frontend")).recents).toEqual([
    { ...a, name: a.tableId },
    { ...b, name: b.tableId },
  ]);
  mocks.orgId = "org-b";
  expect((await listDataRecents("frontend")).recents).toEqual([]);
  mocks.orgId = "org-a";
  mocks.authorize.mockRejectedValue(new Error("access revoked"));
  await expect(listDataRecents("frontend")).rejects.toThrow("access revoked");
});

it("report 807: skips a deleted connection without masking a read failure", async () => {
  const a = { connectionId: "one", tableId: "table:a" };
  const b = { connectionId: "two", tableId: "table:b" };
  await touchDataRecent(a, "frontend");
  await touchDataRecent(b, "frontend");
  mocks.authorize.mockImplementation(async (refs) => {
    if (refs[0].connectionId === "one")
      throw { errorCode: "data_connection_not_found" };
    return refs.map((ref: { tableId: string }) => ref.tableId);
  });
  expect((await listDataRecents("frontend")).recents).toEqual([
    { ...b, name: b.tableId },
  ]);
  mocks.authorize.mockRejectedValue(new Error("unreadable"));
  await expect(listDataRecents("frontend")).rejects.toThrow("unreadable");
});

it("report 807: refuses a write if the workspace changes during authorization", async () => {
  mocks.authorize.mockImplementation(async () => {
    mocks.orgId = "org-b";
    return ["a"];
  });
  await expect(
    touchDataRecent({ connectionId: "one", tableId: "table:a" }, "frontend"),
  ).rejects.toMatchObject({ errorCode: "data_recents_scope_changed" });
  expect(mocks.entries.size).toBe(0);
});
