import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  profiles: vi.fn(),
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({
    ownerEmail: "viewer@example.test",
    orgId: "org",
  }),
}));
vi.mock("../server/model/project-views.js", () => ({
  POPULAR_WINDOW_DAYS: 7,
  listPopularProjects: mocks.list,
}));
vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfilesWithStatus: mocks.profiles,
}));

import action from "./list-popular-projects.js";

beforeEach(() => {
  mocks.list.mockReset();
  mocks.profiles.mockReset();
});

it("report 1794900494.750729 returns names without emails for only the visible page", async () => {
  const project = (
    id: string,
    ownerEmail: string,
    creatorEmail: string | null,
    allowEmbedding = false,
  ) => ({
    id,
    title: id,
    allowEmbedding,
    ownerEmail,
    creatorEmail,
    viewCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    lastEditedAt: "2026-01-02T00:00:00Z",
    lastViewedAt: null,
  });
  mocks.list.mockResolvedValue([
    project("visible", "owner@example.test", "creator@example.test", true),
    project("next-page", "hidden@example.test", null),
  ]);
  mocks.profiles.mockResolvedValue({
    profiles: new Map([
      ["owner@example.test", { name: "Owner Name" }],
      ["creator@example.test", { name: "creator@example.test" }],
    ]),
    incomplete: false,
  });
  const result = await action.run(
    { limit: 1, offset: 0, viewCountDuration: "oneWeek" },
    {} as never,
  );
  expect(mocks.profiles).toHaveBeenCalledWith([
    "owner@example.test",
    "creator@example.test",
  ]);
  expect(result).toMatchObject({
    hasMore: true,
    projects: [
      {
        id: "visible",
        allowEmbedding: true,
        ownerName: "Owner Name",
        creatorName: null,
        namesUnavailable: false,
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("@example.test");
});

it("reports incomplete name reads distinctly", async () => {
  mocks.list.mockResolvedValue([
    {
      id: "one",
      title: "One",
      allowEmbedding: false,
      ownerEmail: "owner@example.test",
      creatorEmail: null,
      viewCount: 0,
      createdAt: "2026-01-01T00:00:00Z",
      lastEditedAt: "2026-01-01T00:00:00Z",
      lastViewedAt: null,
    },
  ]);
  mocks.profiles.mockResolvedValue({ profiles: new Map(), incomplete: true });
  const result = await action.run(
    { limit: 1, offset: 0, viewCountDuration: "oneWeek" },
    {} as never,
  );
  expect(result.projects[0]).toMatchObject({
    ownerName: null,
    creatorName: null,
    namesUnavailable: true,
  });
});
