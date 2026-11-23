import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  navigateAfterWrite: vi.fn(),
  listVisibleProjects: vi.fn(),
  getReadableDoc: vi.fn(),
  cellTextCandidates: vi.fn(),
  listThreads: vi.fn(),
  getThread: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  navigateAfterWrite: state.navigateAfterWrite,
  writeAppStateForCurrentTab: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  listThreads: state.listThreads,
  getThread: state.getThread,
}));

vi.mock("../server/lib/workspace-access.js", () => ({
  currentApplicationId: () => "analytics-2",
  requireCurrentWorkspace: vi.fn().mockResolvedValue({
    ownerEmail: "qa@example.test",
    orgId: "org-1",
    request: { authUserId: "user-1", userName: "QA User" },
  }),
}));

vi.mock("../server/model/project-categories.js", () => ({
  readProjectCategories: vi.fn().mockResolvedValue([]),
}));

vi.mock("../server/model/projects-store.js", () => ({
  listWorkspaceVisibleProjects: state.listVisibleProjects,
  getReadableProjectDocument: state.getReadableDoc,
  projectIdsWithMatchingCellText: state.cellTextCandidates,
}));

import { validateActionArgs } from "@agent-native/core/action";

import searchWorkspace from "./search-workspace.js";

const makeProject = (id: string, title: string) => ({
  id,
  ownerEmail: "qa@example.test",
  title,
  description: "",
  language: "python" as const,
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: "2026-11-20T10:00:00.000Z",
  createdAt: "2026-11-20T09:00:00.000Z",
  updatedAt: "2026-11-20T10:00:00.000Z",
  userUpdatedAt: "2026-11-20T10:00:00.000Z",
  publishedVersionId: null,
});

describe("search-workspace open intent and concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.navigateAfterWrite.mockResolvedValue({ navigated: true });
    state.listVisibleProjects.mockResolvedValue([
      makeProject("prj_rev", "Revenue overview"),
    ]);
    state.getReadableDoc.mockResolvedValue({ cells: [] });
    state.cellTextCandidates.mockImplementation(
      async (_scope: unknown, projects: Array<{ id: string }>) =>
        new Set(projects.map((project) => project.id)),
    );
    state.listThreads.mockResolvedValue([]);
    state.getThread.mockResolvedValue(null);
  });

  it("queues /home/search?q= in the same step when an agent passes intent: open", async () => {
    const parsed = searchWorkspace.schema.parse({
      text: "revenue",
      intent: "open",
    });
    const output = await searchWorkspace.run(parsed, {
      caller: "mcp",
    } as never);

    expect(output.results.map((r) => r.title)).toEqual(["Revenue overview"]);
    expect(output.navigation).toEqual({ status: "requested" });
    expect(state.navigateAfterWrite).toHaveBeenCalledWith(
      { path: "/home/search?q=revenue" },
      expect.objectContaining({ intent: "open" }),
    );
  });

  it("lists every recently opened project up to the recents cap when nothing is typed", async () => {
    state.listVisibleProjects.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        ...makeProject(`p${i}`, `Project ${i}`),
        lastOpenedAt: `2026-11-20T10:0${i}:00.000Z`,
      })),
    );
    const parsed = searchWorkspace.schema.parse({});
    const output = await searchWorkspace.run(parsed, {} as never);

    expect(output.results.map((r) => r.id)).toEqual([
      "p5",
      "p4",
      "p3",
      "p2",
      "p1",
      "p0",
    ]);
  });

  it("filters by owner alone and by date alone with no text typed", async () => {
    state.listVisibleProjects.mockResolvedValue([
      makeProject("mine", "Mine"),
      {
        ...makeProject("theirs", "Theirs"),
        ownerEmail: "them@example.test",
        userUpdatedAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    const owner = await searchWorkspace.run(
      searchWorkspace.schema.parse({ creatorIds: ["them@example.test"] }),
      {} as never,
    );
    expect(owner.results.map((r) => r.id)).toEqual(["theirs"]);

    const dated = await searchWorkspace.run(
      searchWorkspace.schema.parse({ dateFrom: "2026-06-01T00:00:00.000Z" }),
      {} as never,
    );
    expect(dated.results.map((r) => r.id)).toEqual(["mine"]);
  });

  it("does not navigate when intent is omitted", async () => {
    const parsed = searchWorkspace.schema.parse({ text: "revenue" });
    const output = await searchWorkspace.run(parsed, {
      caller: "mcp",
    } as never);

    expect(output.results.map((r) => r.title)).toEqual(["Revenue overview"]);
    expect(output.navigation).toBeUndefined();
    expect(state.navigateAfterWrite).not.toHaveBeenCalled();
  });

  it("validates the project-only flag from GET queries", async () => {
    const validate = (params: Record<string, string>) =>
      validateActionArgs(
        searchWorkspace.schema,
        Object.fromEntries(new URLSearchParams(params)),
        searchWorkspace.tool.parameters,
      );
    expect((await validate({ projectsOnly: "true" })).projectsOnly).toBe(true);
    expect((await validate({ projectsOnly: "false" })).projectsOnly).toBe(
      false,
    );
    expect((await validate({})).projectsOnly).toBe(false);
    await expect(validate({ projectsOnly: "invalid" })).rejects.toThrow();
  });

  it("report A2-QUICK-SEARCH-THREAD-SCAN-1121 returns project-only results without starting a pending conversation read", async () => {
    state.listThreads.mockImplementation(() => new Promise(() => {}));
    const output = await searchWorkspace.run(
      searchWorkspace.schema.parse({
        text: "revenue",
        fields: ["title", "description"],
        projectsOnly: true,
      }),
      {} as never,
    );

    expect(output.results.map((result) => result.id)).toEqual(["prj_rev"]);
    expect(state.listThreads).not.toHaveBeenCalled();
    expect(state.getThread).not.toHaveBeenCalled();
  });

  it("report A2-QUICK-SEARCH-THREAD-SCAN-1121 includes conversations by default", async () => {
    state.listThreads.mockResolvedValueOnce([
      {
        id: "thread-1",
        orgId: "org-1",
        title: "Revenue thread",
        preview: "",
        updatedAt: "2026-11-20T10:00:00.000Z",
        createdAt: "2026-11-20T09:00:00.000Z",
      },
    ]);
    const output = await searchWorkspace.run(
      searchWorkspace.schema.parse({ text: "revenue" }),
      {} as never,
    );

    expect(output.results.map((result) => result.id)).toEqual([
      "prj_rev",
      "thread-1",
    ]);
    expect(state.listThreads).toHaveBeenCalled();
  });

  it("report A2-QUICK-SEARCH-THREAD-SCAN-1121 isolates project-only search even when cellContents are included", async () => {
    state.listThreads.mockImplementation(() => new Promise(() => {}));
    const output = await searchWorkspace.run(
      searchWorkspace.schema.parse({
        text: "revenue",
        fields: ["title", "description", "cellContents"],
        projectsOnly: true,
      }),
      {} as never,
    );

    expect(output.results.map((result) => result.id)).toEqual(["prj_rev"]);
    expect(state.listThreads).not.toHaveBeenCalled();
    expect(state.getThread).not.toHaveBeenCalled();
  });

  it("skips getThread fetches once title/preview matches fill the thread cap", async () => {
    const matchingThreads = Array.from({ length: 5 }, (_, i) => ({
      id: `thr-${i}`,
      orgId: "org-1",
      title: `Revenue thread ${i}`,
      preview: "revenue summary",
      updatedAt: "2026-11-20T10:00:00.000Z",
      createdAt: "2026-11-20T09:00:00.000Z",
    }));
    const nonMatchingThreads = Array.from({ length: 10 }, (_, i) => ({
      id: `other-${i}`,
      orgId: "org-1",
      title: `Other thread ${i}`,
      preview: "unrelated",
      updatedAt: "2026-11-20T10:00:00.000Z",
      createdAt: "2026-11-20T09:00:00.000Z",
    }));
    state.listThreads.mockResolvedValueOnce([
      ...nonMatchingThreads,
      ...matchingThreads,
    ]);

    const parsed = searchWorkspace.schema.parse({ text: "revenue" });
    const output = await searchWorkspace.run(parsed, {} as never);

    const threadIds = output.results
      .filter((r) => r.kind === "thread")
      .map((r) => r.id);
    expect(threadIds).toHaveLength(5);
    expect(state.getThread).not.toHaveBeenCalled();
  });

  it("loads project cell documents concurrently rather than one by one", async () => {
    state.listVisibleProjects.mockResolvedValue([
      makeProject("p1", "Alpha"),
      makeProject("p2", "Beta"),
      makeProject("p3", "Gamma"),
    ]);
    let inFlight = 0;
    let maxInFlight = 0;
    state.getReadableDoc.mockImplementation(async (_scope, id: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return {
        cells:
          id === "p2"
            ? [
                {
                  id: "c1",
                  contents: { kind: "markdown", markdown: "monthly revenue" },
                },
              ]
            : [],
      };
    });

    const parsed = searchWorkspace.schema.parse({ text: "revenue" });
    const output = await searchWorkspace.run(parsed, {} as never);

    expect(maxInFlight).toBeGreaterThan(1);
    expect(output.results.map((r) => r.id)).toEqual(["p2"]);
  });

  it("bounds the conversation scan when nothing matches", async () => {
    state.listThreads.mockImplementation(async () =>
      Array.from({ length: 50 }, (_, i) => ({
        id: `thr-${Math.random()}-${i}`,
        orgId: "org-1",
        title: "Other",
        preview: "unrelated",
        updatedAt: "2026-11-20T10:00:00.000Z",
        createdAt: "2026-11-20T09:00:00.000Z",
      })),
    );
    state.getThread.mockResolvedValue(null);
    const output = await searchWorkspace.run(
      searchWorkspace.schema.parse({ text: "zzz-no-match" }),
      {} as never,
    );
    expect(output.results.filter((r) => r.kind === "thread")).toEqual([]);
    expect(state.listThreads.mock.calls.length).toBeLessThanOrEqual(4);
    expect(state.getThread.mock.calls.length).toBeLessThanOrEqual(200);
  });
});
