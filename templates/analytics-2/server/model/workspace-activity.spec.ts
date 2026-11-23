import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listThreadsMock,
  listCollectionsMock,
  hasConfiguredDataConnectionMock,
  readShellProjectsMock,
} = vi.hoisted(() => ({
  listThreadsMock: vi.fn(),
  listCollectionsMock: vi.fn(),
  hasConfiguredDataConnectionMock: vi.fn(),
  readShellProjectsMock: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  listThreads: listThreadsMock,
}));

vi.mock("./collections-store.js", () => ({
  listCollections: listCollectionsMock,
}));

vi.mock("./data-connections.js", () => ({
  hasConfiguredDataConnection: hasConfiguredDataConnectionMock,
}));

vi.mock("./shell-projects.js", () => ({
  readShellProjects: readShellProjectsMock,
}));

import { resolveRoutePage } from "../../app/components/workspace/pages.js";
import {
  isUnavailableAnalyticsRoute,
  resolveRoute,
} from "../../app/routes/routing/registry.js";
import { readWorkspaceActivity } from "./workspace-activity.js";

const scope = {
  ownerEmail: "qa-fleet@builder.io",
  orgId: "org-1",
};

describe("readWorkspaceActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasConfiguredDataConnectionMock.mockResolvedValue(true);
    readShellProjectsMock.mockResolvedValue({
      recent: [
        {
          id: "prj-published",
          title: "Executive KPIs",
          publishedVersionId: "ver-1",
          favorited: true,
          lastOpenedAt: "2026-11-22T08:00:00.000Z",
          updatedAt: "2026-11-22T07:00:00.000Z",
        },
        {
          id: "prj-draft",
          title: "Funnel exploration",
          publishedVersionId: null,
          favorited: false,
          lastOpenedAt: null,
          updatedAt: "2026-11-22T06:00:00.000Z",
        },
      ],
      favorites: [
        {
          id: "prj-published",
          title: "Executive KPIs",
          publishedVersionId: "ver-1",
        },
        {
          id: "prj-draft",
          title: "Funnel exploration",
          publishedVersionId: null,
        },
      ],
    });
    listCollectionsMock.mockResolvedValue([
      {
        id: "col-revenue",
        name: "Revenue",
        favorited: true,
        children: [
          {
            id: "col/q4 ops",
            name: "Q4 Ops",
            favorited: true,
            children: [],
          },
          {
            id: "col-unstarred",
            name: "Archive Notes",
            favorited: false,
            children: [],
          },
        ],
      },
    ]);
    listThreadsMock.mockResolvedValue([
      {
        id: "thr-1",
        title: "Signup conversion breakdown",
        orgId: "org-1",
        updatedAt: Date.parse("2026-11-22T08:30:00.000Z"),
      },
    ]);
  });

  it("opens published favorite projects in app view and unpublished favorites in the notebook", async () => {
    const activity = await readWorkspaceActivity(scope, "analytics-2");
    const projectFavorites = activity.favorites.filter(
      (row) => row.kind === "project",
    );

    expect(projectFavorites).toEqual([
      {
        id: "prj-published",
        title: "Executive KPIs",
        kind: "project",
        href: "/app/prj-published/latest",
      },
      {
        id: "prj-draft",
        title: "Funnel exploration",
        kind: "project",
        href: "/project/prj-draft/latest",
      },
    ]);
  });

  it("emits canonical collection links for favorited collections instead of /home/collections/:id", async () => {
    const activity = await readWorkspaceActivity(scope, "analytics-2");
    const collectionFavorites = activity.favorites.filter(
      (row) => row.kind === "collection",
    );

    expect(collectionFavorites).toEqual([
      {
        id: "col-revenue",
        title: "Revenue",
        kind: "collection",
        href: "/collection/col-revenue",
      },
      {
        id: "col/q4 ops",
        title: "Q4 Ops",
        kind: "collection",
        href: "/collection/col%2Fq4%20ops",
      },
    ]);

    for (const row of collectionFavorites) {
      const route = resolveRoute(row.href);
      expect(route.id).toBe("collection");
      expect(route.params.collectionId).toBe(row.id);
      expect(isUnavailableAnalyticsRoute(route)).toBe(false);
      expect(resolveRoutePage(route)).toBeDefined();
    }
  });

  it("resolves every Home and sidebar activity href to a registered route page", async () => {
    const activity = await readWorkspaceActivity(scope, "analytics-2");
    const hrefs = [
      ...activity.recents.map((row) => row.href),
      ...activity.favorites.map((row) => row.href),
      ...activity.homeRecents.projects.flatMap((row) =>
        row.notebookHref ? [row.href, row.notebookHref] : [row.href],
      ),
      ...activity.homeRecents.threads.map((row) => row.href),
    ];

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const route = resolveRoute(href);
      expect(isUnavailableAnalyticsRoute(route), href).toBe(false);
      expect(resolveRoutePage(route), href).toBeDefined();
    }
  });
});
