import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  orgId: null as string | null,
  spaceOrgId: null as string | null,
  discovery: vi.fn(),
  select: vi.fn(),
  getSetting: vi.fn(),
  mutateSetting: vi.fn(),
  favorites: vi.fn(),
}));

vi.mock("./_content-favorites.js", () => ({
  favoriteDocumentIds: boundary.favorites,
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
vi.mock("./_content-space-access.js", () => ({
  resolveContentSpaceAccess: async () => ({
    space: {
      filesDatabaseId: "files-db",
      orgId: boundary.spaceOrgId,
    },
  }),
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
    contentDatabaseItems: {
      databaseId: "item-database-id",
      documentId: "item-document-id",
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
import removeRecent from "./remove-content-recent.js";
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
  boundary.favorites.mockReset();
  boundary.favorites.mockResolvedValue(new Set());
  boundary.orgId = null;
  boundary.spaceOrgId = null;
  stored.clear();
  boundary.getSetting.mockImplementation(
    async (email: string, key: string) =>
      stored.get(settingId(email, key)) ?? null,
  );
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

  it("falls back explicitly to the first saved View when the recent View was removed", async () => {
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
    ).toEqual([
      {
        ...entry("page", { databaseId: "db", viewId: "default" }),
        target: { documentId: "page", databaseId: "db", viewId: "board" },
        title: "Database",
        icon: null,
        viewName: "Board",
        fallback: {
          reason: "saved_view_unavailable",
          requestedViewId: "default",
        },
      },
    ]);
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

  it("filters by current Files membership before resolving Recent rows", async () => {
    rowsOnce([{ documentId: "in-space" }]);
    rowsOnce([{ id: "in-space", title: "In space", icon: null }]);
    expect(
      await resolveContentRecentEntries(
        alice.userEmail,
        [entry("outside"), entry("in-space")],
        "space-a",
      ),
    ).toEqual([
      {
        ...entry("in-space"),
        title: "In space",
        icon: null,
        viewName: null,
      },
    ]);
    expect(boundary.discovery).toHaveBeenCalledWith(
      expect.objectContaining({ additional: expect.anything() }),
    );
  });

  it("returns no Recent rows when the selected space belongs to another org", async () => {
    boundary.orgId = "org-a";
    boundary.spaceOrgId = "org-b";
    expect(
      await resolveContentRecentEntries(
        alice.userEmail,
        [entry("org-b-page")],
        "org-b-space",
      ),
    ).toEqual([]);
    expect(boundary.select).not.toHaveBeenCalled();
    expect(boundary.discovery).not.toHaveBeenCalled();
  });

  it("keeps the get action empty for an authorized space in another org", async () => {
    boundary.orgId = "org-a";
    boundary.spaceOrgId = "org-b";
    stored.set(settingId(alice.userEmail, contentRecentSettingKey()), {
      version: 2,
      entries: [entry("org-b-page")],
    });
    const spaceId = "org-b-space";
    expect(await getRecent.run({ spaceId }, alice)).toEqual({
      entries: [],
      scopeKey: JSON.stringify([alice.userEmail, "org-a", spaceId]),
    });
    expect(boundary.select).not.toHaveBeenCalled();
  });

  it("resolves scoped Recent rows when the selected space matches the active org", async () => {
    boundary.orgId = "org-a";
    boundary.spaceOrgId = "org-a";
    rowsOnce([{ documentId: "org-a-page" }]);
    rowsOnce([{ id: "org-a-page", title: "Org A", icon: null }]);
    expect(
      await resolveContentRecentEntries(
        alice.userEmail,
        [entry("org-a-page")],
        "org-a-space",
      ),
    ).toEqual([
      {
        ...entry("org-a-page"),
        title: "Org A",
        icon: null,
        viewName: null,
      },
    ]);
    expect(boundary.discovery).toHaveBeenCalledWith(
      expect.objectContaining({ authorizedOrgIds: ["org-a"] }),
    );
  });

  it("falls back within the same database and omits an unavailable database", async () => {
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
    ).toEqual([
      {
        ...entry("page", { databaseId: "db", viewId: "removed" }),
        target: { documentId: "page", databaseId: "db", viewId: "default" },
        title: "Database page",
        icon: null,
        viewName: "Default",
        fallback: {
          reason: "saved_view_unavailable",
          requestedViewId: "removed",
        },
      },
    ]);
  });

  it("prefers a valid personal active View for a removed recent View", async () => {
    stored.set(
      settingId(alice.userEmail, "content-database-personal-view:db"),
      {
        version: 2,
        activeViewId: "board",
        views: [],
      },
    );
    rowsOnce([{ id: "page", title: "Database", icon: null }]);
    rowsOnce([
      {
        id: "db",
        documentId: "page",
        viewConfigJson: JSON.stringify({
          activeViewId: "table",
          views: [
            { id: "table", name: "Table" },
            { id: "board", name: "Board" },
          ],
        }),
      },
    ]);
    const [result] = await resolveContentRecentEntries(alice.userEmail, [
      entry("page", { databaseId: "db", viewId: "removed" }),
    ]);
    expect(result.target.viewId).toBe("board");
    expect(result.fallback).toEqual({
      reason: "saved_view_unavailable",
      requestedViewId: "removed",
    });
  });

  it("reconciles an accessible database alias to its backing page", async () => {
    rowsOnce([{ id: "alias", title: "Alias", icon: null }]);
    rowsOnce([
      {
        id: "db",
        documentId: "backing-page",
        viewConfigJson: JSON.stringify({
          views: [{ id: "table", name: "Table" }],
        }),
      },
    ]);
    rowsOnce([{ id: "backing-page", title: "Database", icon: null }]);
    const [result] = await resolveContentRecentEntries(alice.userEmail, [
      entry("alias", { databaseId: "db", viewId: "table" }),
    ]);
    expect(result.target).toEqual({
      documentId: "backing-page",
      databaseId: "db",
      viewId: "table",
    });
    expect(result.title).toBe("Database");
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
  it("atomically migrates v1 duplicates against the latest setting value", async () => {
    const id = settingId(alice.userEmail, contentRecentSettingKey());
    const legacy = {
      version: 1,
      entries: [
        entry("page", { databaseId: "db", viewId: "table" }),
        entry("page", { databaseId: "db", viewId: "board" }),
      ],
    };
    boundary.getSetting.mockResolvedValueOnce(legacy);
    stored.set(id, {
      version: 2,
      entries: [entry("page", { databaseId: "db", viewId: "board" })],
    });
    rowsOnce([{ id: "page", title: "Database", icon: null }]);
    rowsOnce([
      {
        id: "db",
        documentId: "page",
        viewConfigJson: JSON.stringify({
          views: [{ id: "table", name: "Table" }],
        }),
      },
    ]);
    const result = await getRecent.run({}, alice);
    expect(result.entries).toHaveLength(1);
    expect(stored.get(id)).toMatchObject({
      version: 2,
      entries: [{ target: { databaseId: "db", viewId: "board" } }],
    });
  });

  it("reports the requester's pinned state only for resolved rows", async () => {
    stored.set(settingId(alice.userEmail, contentRecentSettingKey()), {
      version: 2,
      entries: [entry("pinned"), entry("plain"), entry("revoked")],
    });
    rowsOnce([
      { id: "pinned", title: "Pinned page", icon: null },
      { id: "plain", title: "Plain page", icon: null },
    ]);
    boundary.favorites.mockResolvedValueOnce(new Set(["pinned"]));
    const result = await getRecent.run({}, alice);
    expect(boundary.favorites).toHaveBeenCalledWith(
      expect.anything(),
      alice.userEmail,
      ["pinned", "plain"],
    );
    expect(
      result.entries.map(({ target, isFavorite }) => [
        target.documentId,
        isFavorite,
      ]),
    ).toEqual([
      ["pinned", true],
      ["plain", false],
    ]);
  });

  it("skips the pinned lookup when nothing resolves", async () => {
    expect(await getRecent.run({}, alice)).toMatchObject({ entries: [] });
    expect(boundary.favorites).not.toHaveBeenCalled();
  });

  it("removes one destination for the requester only", async () => {
    boundary.orgId = "org-a";
    const key = contentRecentSettingKey();
    stored.set(settingId(alice.userEmail, key), {
      version: 2,
      entries: [
        entry("keep"),
        entry("page", { databaseId: "db", viewId: "board" }),
      ],
    });
    stored.set(settingId(bob.userEmail, key), {
      version: 2,
      entries: [entry("page", { databaseId: "db", viewId: "table" })],
    });
    expect(
      await removeRecent.run(
        { documentId: "page", databaseId: "db", viewId: "table" },
        alice,
      ),
    ).toMatchObject({ removed: true });
    expect(stored.get(settingId(alice.userEmail, key))).toMatchObject({
      entries: [{ target: { documentId: "keep" } }],
    });
    expect(stored.get(settingId(bob.userEmail, key))).toMatchObject({
      entries: [{ target: { databaseId: "db" } }],
    });
    expect(
      await removeRecent.run({ documentId: "missing" }, alice),
    ).toMatchObject({ removed: false });
    expect(boundary.select).not.toHaveBeenCalled();
  });

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
      scopeKey: JSON.stringify([bob.userEmail, "org-a", null]),
    });
    boundary.orgId = "org-b";
    expect(await getRecent.run({}, alice)).toEqual({
      entries: [],
      scopeKey: JSON.stringify([alice.userEmail, "org-b", null]),
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
    const scopeKey = JSON.stringify([alice.userEmail, null, null]);
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
      updateSidebar.run({ version: 2, expandedDocumentIds: ["page"] }, alice),
      updateSidebar.run({ version: 2, sections }, alice),
    ]);
    expect(
      stored.get(settingId(alice.userEmail, "content-sidebar-state")),
    ).toEqual({
      version: 2,
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
    await expect(updateSidebar.run({ version: 2 }, alice)).rejects.toThrow();
    expect(stored.get(id)).toEqual({ version: 99 });
    boundary.mutateSetting.mockRejectedValueOnce(new Error("write failed"));
    await expect(updateSidebar.run({ version: 2 }, alice)).rejects.toThrow(
      "write failed",
    );
  });
});
