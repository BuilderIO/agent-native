import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  access: vi.fn(),
  select: vi.fn(),
  mutate: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: boundary.read,
  mutateUserSetting: boundary.mutate,
  putUserSetting: boundary.put,
  deleteUserSetting: boundary.remove,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: boundary.select }),
  schema: {
    contentDatabases: { id: "database-id", viewConfigJson: "view-config" },
    contentDatabaseItems: { id: "item-id", databaseId: "database-id" },
  },
}));
vi.mock("./_content-database-personal-view.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./_content-database-personal-view.js")
  >()),
  assertContentDatabaseViewerAccess: boundary.access,
}));

import {
  CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
  type ContentDatabasePersonalViewOverrides,
} from "../shared/api.js";
import { readPersonalDatabaseViewOverrides } from "./_content-database-personal-view.js";
import { filesParentPropertyId } from "./_files-system-properties.js";
import action from "./update-content-database-personal-view.js";

const ctx = { userEmail: "navigation@example.test" };
let saved: unknown;
let systemRole: string | null;

function initialState(): ContentDatabasePersonalViewOverrides {
  return {
    version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
    activeViewId: "table",
    views: [
      {
        id: "table",
        sorts: [{ key: "title", label: "Title", direction: "desc" }],
        filters: [
          { key: "status", label: "Status", operator: "equals", value: "open" },
        ],
        filterMode: "or",
        sidebarOrder: { mode: "custom", itemIds: ["old-item"] },
      },
      {
        id: "board",
        sorts: [{ key: "priority", label: "Priority", direction: "asc" }],
        filters: [],
        filterMode: "and",
        sidebarOrder: { mode: "name", itemIds: ["board-item"] },
      },
    ],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  saved = initialState();
  systemRole = null;
  boundary.access.mockResolvedValue(undefined);
  boundary.read.mockImplementation(async () => saved);
  boundary.select.mockImplementation((projection: Record<string, unknown>) => ({
    from: () => ({
      where: async () =>
        "viewConfigJson" in projection
          ? [
              {
                systemRole,
                viewConfigJson: JSON.stringify({
                  views: initialState().views,
                }),
              },
            ]
          : "systemRole" in projection
            ? [{ systemRole }]
            : [{ id: "item-a" }, { id: "item-b" }],
    }),
  }));
  // Serialize callbacks at the settings boundary; SQL/CAS belongs to its own tests.
  let queue = Promise.resolve();
  boundary.mutate.mockImplementation(
    (_email: string, _key: string, mutate: (current: unknown) => unknown) => {
      const result = queue.then(() => {
        saved = mutate(saved);
        return saved;
      });
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  );
});

describe("personal navigation patch action", () => {
  it("distinguishes absent personal state from unreadable stored state on reads", async () => {
    saved = null;
    expect(
      await readPersonalDatabaseViewOverrides(ctx.userEmail, "db"),
    ).toBeNull();
    saved = { version: 99 };
    await expect(
      readPersonalDatabaseViewOverrides(ctx.userEmail, "db"),
    ).rejects.toThrow();
  });
  it("seeds the first sidebar override from the shared View's query", async () => {
    saved = null;
    await action.run(
      {
        databaseId: "db",
        navigation: {
          sidebarOrder: {
            viewId: "table",
            mode: "custom",
            itemIds: ["item-b", "item-a"],
          },
        },
      },
      ctx,
    );
    expect(saved).toMatchObject({
      views: [
        {
          ...initialState().views[0],
          sidebarOrder: { mode: "custom", itemIds: ["item-b", "item-a"] },
        },
      ],
    });
  });

  it.each([null, "files"])(
    "migrates v1 inside the atomic update (system role: %s)",
    async (role) => {
      systemRole = role;
      const original = initialState();
      const legacyParentFilter = {
        key: filesParentPropertyId("db"),
        label: "Parent",
        operator: "is_empty" as const,
        value: "",
      };
      saved = {
        ...original,
        version: 1,
        views: [
          {
            ...original.views[0],
            filters: [...original.views[0].filters, legacyParentFilter],
          },
          original.views[1],
        ],
      };
      const migratedRead = await readPersonalDatabaseViewOverrides(
        ctx.userEmail,
        "db",
      );
      await action.run(
        { databaseId: "db", navigation: { activeViewId: "board" } },
        ctx,
      );
      expect(saved).toEqual({ ...migratedRead, activeViewId: "board" });
      expect(saved).toEqual({
        ...original,
        activeViewId: "board",
        views: [
          {
            ...original.views[0],
            filters:
              role === "files"
                ? original.views[0].filters
                : [...original.views[0].filters, legacyParentFilter],
          },
          original.views[1],
        ],
      });
    },
  );
  it.each([false, true])(
    "preserves overlapping selection and sidebar edits (reverse dispatch: %s)",
    async (reverse) => {
      const original = initialState();
      const select = () =>
        action.run(
          { databaseId: "db", navigation: { activeViewId: "board" } },
          ctx,
        );
      const reorder = () =>
        action.run(
          {
            databaseId: "db",
            navigation: {
              sidebarOrder: {
                viewId: "table",
                mode: "custom",
                itemIds: ["item-b", "foreign-item", "item-a", "item-b"],
              },
            },
          },
          ctx,
        );
      await Promise.all(
        (reverse ? [reorder, select] : [select, reorder]).map((run) => run()),
      );
      expect(saved).toEqual({
        ...original,
        activeViewId: "board",
        views: [
          {
            ...original.views[0],
            sidebarOrder: { mode: "custom", itemIds: ["item-b", "item-a"] },
          },
          original.views[1],
        ],
      });
      expect(boundary.access).toHaveBeenCalledTimes(2);
      expect(boundary.mutate).toHaveBeenCalledTimes(2);
      expect(boundary.mutate).toHaveBeenCalledWith(
        ctx.userEmail,
        "content-database-personal-view:db",
        expect.any(Function),
      );
      expect(boundary.put).not.toHaveBeenCalled();
      expect(boundary.remove).not.toHaveBeenCalled();
    },
  );

  it.each([
    { activeViewId: "deleted-view" },
    {
      sidebarOrder: {
        viewId: "deleted-view",
        mode: "custom" as const,
        itemIds: [],
      },
    },
  ])(
    "rejects an unavailable exact View without changing personal state: %j",
    async (navigation) => {
      await expect(
        action.run({ databaseId: "db", navigation }, ctx),
      ).rejects.toThrow("View is unavailable");
      expect(saved).toEqual(initialState());
      expect(boundary.mutate).not.toHaveBeenCalled();
    },
  );

  it("stops before loading View metadata when database access is denied", async () => {
    boundary.access.mockRejectedValueOnce(new Error("Access denied"));
    await expect(
      action.run(
        { databaseId: "db", navigation: { activeViewId: "board" } },
        ctx,
      ),
    ).rejects.toThrow("Access denied");
    expect(boundary.select).not.toHaveBeenCalled();
    expect(boundary.mutate).not.toHaveBeenCalled();
  });

  it("requires exactly one update form", () => {
    expect(() => action.schema.parse({ databaseId: "db" })).toThrow();
    expect(() =>
      action.schema.parse({
        databaseId: "db",
        overrides: initialState(),
        navigation: { activeViewId: "board" },
      }),
    ).toThrow();
    expect(() =>
      action.schema.parse({
        databaseId: "db",
        overrides: null,
        navigation: { activeViewId: "board" },
      }),
    ).toThrow();
  });

  it("does not replace unreadable personal state during a navigation update", async () => {
    saved = { version: 99 };
    await expect(
      action.run(
        { databaseId: "db", navigation: { activeViewId: "board" } },
        ctx,
      ),
    ).rejects.toThrow();
    expect(saved).toEqual({ version: 99 });
  });
});
