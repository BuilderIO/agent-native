import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  orgId: null as string | null,
  discovery: vi.fn(),
  select: vi.fn(),
  getSetting: vi.fn(),
  mutateSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => boundary.orgId,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: boundary.getSetting,
  mutateUserSetting: boundary.mutateSetting,
}));
vi.mock("./_document-discovery-query.js", () => ({
  documentDiscoveryWhere: boundary.discovery,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: boundary.select }),
  schema: {
    documents: { id: "document-id", title: "title", icon: "icon" },
    contentDatabases: {
      id: "database-id",
      documentId: "database-document-id",
      viewConfigJson: "view-config",
      deletedAt: "deleted-at",
    },
  },
}));

import {
  defaultContentSidebarSections,
  type ContentRecentEntry,
} from "../shared/content-personal-navigation.js";
import {
  contentRecentSettingKey,
  resolveContentRecentEntries,
} from "./_content-recent.js";
import getRecent from "./get-content-recent.js";
import recordVisit from "./record-content-visit.js";
import updateSidebar from "./update-content-sidebar-state.js";

const alice = { userEmail: "alice@example.test" };
const bob = { userEmail: "bob@example.test" };
const entry = (documentId: string, extra = {}): ContentRecentEntry => ({
  target: { documentId, ...extra },
  visitedAt: "2026-09-09T12:00:00.000Z",
});
const stored = new Map<string, unknown>();
const settingId = (email: string, key: string) => JSON.stringify([email, key]);

function rowsOnce(rows: unknown[]) {
  boundary.select.mockReturnValueOnce({
    from: () => ({ where: async () => rows }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.select.mockReset();
  boundary.orgId = null;
  stored.clear();
  boundary.getSetting.mockImplementation(
    async (email: string, key: string) =>
      stored.get(settingId(email, key)) ?? null,
  );
  // Model the settings mutation boundary's serialization, not its SQL/CAS implementation.
  let queue = Promise.resolve();
  boundary.mutateSetting.mockImplementation(
    (email: string, key: string, mutate: (current: unknown) => unknown) => {
      const operation = queue.then(() => {
        const id = settingId(email, key);
        const next = mutate(stored.get(id) ?? null);
        stored.set(id, next);
        return next;
      });
      queue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  );
});

describe("Recent access resolution", () => {
  it("rejects corrupt View identities rather than turning them into an implicit default", async () => {
    rowsOnce([{ id: "page", title: "Database", icon: null }]);
    rowsOnce([
      {
        id: "db",
        documentId: "page",
        viewConfigJson: JSON.stringify({
          views: [{ id: "", name: "Invalid" }],
        }),
      },
    ]);
    await expect(
      resolveContentRecentEntries(alice.userEmail, [
        entry("page", { databaseId: "db", viewId: "default" }),
      ]),
    ).rejects.toThrow();
  });

  it.each([{}, { views: [] }, { sorts: [], filters: [], columnWidths: {} }])(
    "resolves the canonical initial Table from legacy configuration %j",
    async (viewConfig) => {
      const visit = entry("page", { databaseId: "db", viewId: "default" });
      rowsOnce([{ id: "page", title: "New database", icon: null }]);
      rowsOnce([
        {
          id: "db",
          documentId: "page",
          viewConfigJson: JSON.stringify(viewConfig),
        },
      ]);
      expect(
        await resolveContentRecentEntries(alice.userEmail, [visit]),
      ).toEqual([
        { ...visit, title: "New database", icon: null, viewName: "Table" },
      ]);
    },
  );

  it("does not invent a removed default View when other saved Views exist", async () => {
    rowsOnce([{ id: "page", title: "Database", icon: null }]);
    rowsOnce([
      {
        id: "db",
        documentId: "page",
        viewConfigJson: JSON.stringify({
          views: [{ id: "board", name: "Board" }],
        }),
      },
    ]);
    expect(
      await resolveContentRecentEntries(alice.userEmail, [
        entry("page", { databaseId: "db", viewId: "default" }),
      ]),
    ).toEqual([]);
  });

  it("uses only the current org context and the requesting user", async () => {
    boundary.orgId = "current-org";
    rowsOnce([]);
    await resolveContentRecentEntries(alice.userEmail, [entry("page")]);
    expect(boundary.discovery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userEmail: alice.userEmail,
        authorizedOrgIds: ["current-org"],
      }),
    );
    boundary.orgId = null;
    rowsOnce([]);
    await resolveContentRecentEntries(alice.userEmail, [entry("page")]);
    expect(boundary.discovery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        authorizedOrgIds: [],
      }),
    );
  });

  it("resolves fresh labels and omits rows no longer returned by access discovery", async () => {
    rowsOnce([{ id: "page", title: "Current title", icon: null }]);
    const visits = [entry("page"), entry("revoked"), entry("trashed")];
    expect(await resolveContentRecentEntries(alice.userEmail, visits)).toEqual([
      { ...visits[0], title: "Current title", icon: null, viewName: null },
    ]);
    rowsOnce([]);
    expect(await resolveContentRecentEntries(alice.userEmail, visits)).toEqual(
      [],
    );
    expect(boundary.select).toHaveBeenCalledTimes(2);
  });

  it("never substitutes another View or Database for an unavailable exact target", async () => {
    rowsOnce([{ id: "page", title: "Database page", icon: null }]);
    rowsOnce([
      {
        id: "db",
        documentId: "page",
        viewConfigJson: JSON.stringify({
          activeViewId: "default",
          views: [{ id: "default", name: "Default" }],
        }),
      },
    ]);
    expect(
      await resolveContentRecentEntries(alice.userEmail, [
        entry("page", { databaseId: "db", viewId: "removed" }),
        entry("page", { databaseId: "deleted-db", viewId: "default" }),
      ]),
    ).toEqual([]);
  });

  it("uses the exact View's current label and rejects corrupt View configuration", async () => {
    const visit = entry("page", { databaseId: "db", viewId: "board" });
    rowsOnce([{ id: "page", title: "Current page", icon: null }]);
    rowsOnce([
      {
        id: "db",
        documentId: "page",
        viewConfigJson: JSON.stringify({
          views: [{ id: "board", name: "Current board" }],
        }),
      },
    ]);
    expect(await resolveContentRecentEntries(alice.userEmail, [visit])).toEqual(
      [
        {
          ...visit,
          title: "Current page",
          icon: null,
          viewName: "Current board",
        },
      ],
    );
    rowsOnce([{ id: "page", title: "Current page", icon: null }]);
    rowsOnce([{ id: "db", documentId: "page", viewConfigJson: "broken" }]);
    await expect(
      resolveContentRecentEntries(alice.userEmail, [visit]),
    ).rejects.toThrow();
  });
});

describe("Recent action persistence", () => {
  it("records a newly created database's implicit default View", async () => {
    rowsOnce([{ id: "page", title: "New database", icon: null }]);
    rowsOnce([{ id: "db", documentId: "page", viewConfigJson: "{}" }]);
    const target = { documentId: "page", databaseId: "db", viewId: "default" };
    expect(await recordVisit.run(target, alice)).toEqual({ recorded: true });
    expect(
      stored.get(settingId(alice.userEmail, contentRecentSettingKey())),
    ).toMatchObject({
      entries: [{ target }],
    });
  });

  it("isolates both user and current-context settings", async () => {
    boundary.orgId = "org-a";
    rowsOnce([{ id: "page", title: "Page", icon: null }]);
    await recordVisit.run({ documentId: "page" }, alice);
    expect(boundary.mutateSetting).toHaveBeenCalledWith(
      alice.userEmail,
      'content-recent:"org-a"',
      expect.any(Function),
    );
    expect(await getRecent.run({}, bob)).toEqual({
      entries: [],
      scopeKey: JSON.stringify([bob.userEmail, "org-a"]),
    });
    boundary.orgId = "org-b";
    expect(await getRecent.run({}, alice)).toEqual({
      entries: [],
      scopeKey: JSON.stringify([alice.userEmail, "org-b"]),
    });
    expect(contentRecentSettingKey()).toBe('content-recent:"org-b"');
  });

  it("rejects a stale user or org scope before reading any saved navigation", async () => {
    boundary.orgId = "current-org";
    for (const scopeKey of [
      JSON.stringify([bob.userEmail, "current-org"]),
      JSON.stringify([alice.userEmail, "previous-org"]),
    ]) {
      await expect(getRecent.run({ scopeKey }, alice)).rejects.toThrow(
        "Navigation context changed",
      );
    }
    expect(boundary.getSetting).not.toHaveBeenCalled();
    expect(boundary.select).not.toHaveBeenCalled();
  });

  it("accepts and returns the normalized identity scope", async () => {
    const scopeKey = JSON.stringify([alice.userEmail, null]);
    expect(
      await getRecent.run({ scopeKey }, { userEmail: " Alice@Example.Test " }),
    ).toEqual({ scopeKey, entries: [] });
  });

  it("preserves concurrent visits using the mutation callback's current value", async () => {
    rowsOnce([{ id: "first", title: "First", icon: null }]);
    rowsOnce([{ id: "second", title: "Second", icon: null }]);
    await Promise.all([
      recordVisit.run({ documentId: "first" }, alice),
      recordVisit.run({ documentId: "second" }, alice),
    ]);
    expect(boundary.getSetting).not.toHaveBeenCalled();
    const state = stored.get(
      settingId(alice.userEmail, contentRecentSettingKey()),
    );
    expect(state).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ target: { documentId: "first" } }),
        expect.objectContaining({ target: { documentId: "second" } }),
      ]),
    });
  });

  it("refuses unavailable visits before writing", async () => {
    rowsOnce([]);
    await expect(
      recordVisit.run({ documentId: "revoked" }, alice),
    ).rejects.toThrow("unavailable");
    expect(boundary.mutateSetting).not.toHaveBeenCalled();
  });

  it("does not replace corrupt Recent state with a successful new visit", async () => {
    const id = settingId(alice.userEmail, contentRecentSettingKey());
    stored.set(id, { version: 99, entries: [] });
    rowsOnce([{ id: "page", title: "Page", icon: null }]);
    await expect(
      recordVisit.run({ documentId: "page" }, alice),
    ).rejects.toThrow();
    expect(stored.get(id)).toEqual({ version: 99, entries: [] });
  });

  it("propagates persisted corruption, setting read failures, and target read failures", async () => {
    stored.set(settingId(alice.userEmail, contentRecentSettingKey()), {
      version: 1,
      entries: "bad",
    });
    await expect(getRecent.run({}, alice)).rejects.toThrow();
    boundary.getSetting.mockRejectedValueOnce(new Error("settings offline"));
    await expect(getRecent.run({}, alice)).rejects.toThrow("settings offline");
    boundary.select.mockImplementationOnce(() => {
      throw new Error("database offline");
    });
    await expect(
      recordVisit.run({ documentId: "page" }, alice),
    ).rejects.toThrow("database offline");
    expect(boundary.mutateSetting).not.toHaveBeenCalled();
  });
});

describe("sidebar partial state persistence", () => {
  it("merges simultaneous expansion and section edits without overwriting either", async () => {
    const sections = defaultContentSidebarSections();
    sections.recent.visible = false;
    await Promise.all([
      updateSidebar.run({ version: 1, expandedDocumentIds: ["page"] }, alice),
      updateSidebar.run({ version: 1, sections }, alice),
    ]);
    expect(
      stored.get(settingId(alice.userEmail, "content-sidebar-state")),
    ).toEqual({
      version: 1,
      expandedDocumentIds: ["page"],
      sections,
    });
    expect(stored.has(settingId(bob.userEmail, "content-sidebar-state"))).toBe(
      false,
    );
  });

  it("does not overwrite corrupt persisted state or report a failed mutation as saved", async () => {
    const id = settingId(alice.userEmail, "content-sidebar-state");
    stored.set(id, { version: 99 });
    await expect(updateSidebar.run({ version: 1 }, alice)).rejects.toThrow();
    expect(stored.get(id)).toEqual({ version: 99 });
    boundary.mutateSetting.mockRejectedValueOnce(new Error("write failed"));
    await expect(updateSidebar.run({ version: 1 }, alice)).rejects.toThrow(
      "write failed",
    );
  });
});
