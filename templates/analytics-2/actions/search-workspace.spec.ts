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

describe("search-workspace thread scan bounds (A2-QUICK-SEARCH-THREAD-SCAN-1121)", () => {
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

  it("bounds getThread body scans to 20 when scanning multiple non-matching pages", async () => {
    state.listThreads.mockImplementation(async () =>
      Array.from({ length: 50 }, (_, i) => ({
        id: `thr-${Math.random()}-${i}`,
        orgId: "org-1",
        title: "Unrelated topic",
        preview: "no match here",
        updatedAt: "2026-11-20T10:00:00.000Z",
        createdAt: "2026-11-20T09:00:00.000Z",
      })),
    );
    state.getThread.mockResolvedValue(null);

    const output = await searchWorkspace.run(
      searchWorkspace.schema.parse({ text: "target-keyword" }),
      {} as never,
    );

    expect(output.results.filter((r) => r.kind === "thread")).toEqual([]);
    expect(state.getThread.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it("returns project-only results without querying conversations when projectsOnly is true", async () => {
    state.listThreads.mockImplementation(() => new Promise(() => {}));
    const output = await searchWorkspace.run(
      searchWorkspace.schema.parse({
        text: "revenue",
        projectsOnly: true,
      }),
      {} as never,
    );

    expect(output.results.map((result) => result.id)).toEqual(["prj_rev"]);
    expect(state.listThreads).not.toHaveBeenCalled();
    expect(state.getThread).not.toHaveBeenCalled();
  });

  it("finds thread by body content within the scan budget", async () => {
    const threadList = Array.from({ length: 10 }, (_, i) => ({
      id: `thr-${i}`,
      orgId: "org-1",
      title: `General chat ${i}`,
      preview: "hello",
      updatedAt: "2026-11-20T10:00:00.000Z",
      createdAt: "2026-11-20T09:00:00.000Z",
    }));
    state.listThreads.mockResolvedValueOnce(threadList);
    state.getThread.mockImplementation(async (id: string) => {
      if (id === "thr-3") {
        return {
          id: "thr-3",
          orgId: "org-1",
          ownerEmail: "qa@example.test",
          source: { appId: "analytics-2" },
          threadData: JSON.stringify({
            messages: [{ text: "deep body match for keyword" }],
          }),
        };
      }
      return null;
    });

    const output = await searchWorkspace.run(
      searchWorkspace.schema.parse({ text: "keyword" }),
      {} as never,
    );

    const threads = output.results.filter((r) => r.kind === "thread");
    expect(threads.map((t) => t.id)).toEqual(["thr-3"]);
  });

  it("ignores serialized thread JSON metadata keys while matching visible message text", async () => {
    state.listThreads.mockResolvedValueOnce([
      {
        id: "thr-meta",
        orgId: "org-1",
        title: "Weekly standup",
        preview: "status update",
        updatedAt: "2026-11-20T10:00:00.000Z",
        createdAt: "2026-11-20T09:00:00.000Z",
      },
    ]);
    state.getThread.mockResolvedValueOnce({
      id: "thr-meta",
      orgId: "org-1",
      ownerEmail: "qa@example.test",
      source: { appId: "analytics-2" },
      threadData: JSON.stringify({
        messages: [
          {
            role: "assistant",
            parts: [
              {
                type: "text",
                toolCallId: "call_xyz",
                text: "Quarterly retention improved by 4 percent",
              },
            ],
          },
        ],
      }),
    });

    const metaQuery = await searchWorkspace.run(
      searchWorkspace.schema.parse({ text: "assistant" }),
      {} as never,
    );
    expect(metaQuery.results.filter((r) => r.kind === "thread")).toEqual([]);

    state.listThreads.mockResolvedValueOnce([
      {
        id: "thr-meta",
        orgId: "org-1",
        title: "Weekly standup",
        preview: "status update",
        updatedAt: "2026-11-20T10:00:00.000Z",
        createdAt: "2026-11-20T09:00:00.000Z",
      },
    ]);
    state.getThread.mockResolvedValueOnce({
      id: "thr-meta",
      orgId: "org-1",
      ownerEmail: "qa@example.test",
      source: { appId: "analytics-2" },
      threadData: JSON.stringify({
        messages: [
          {
            role: "assistant",
            parts: [
              {
                type: "text",
                toolCallId: "call_xyz",
                text: "Quarterly retention improved by 4 percent",
              },
            ],
          },
        ],
      }),
    });

    const textQuery = await searchWorkspace.run(
      searchWorkspace.schema.parse({ text: "retention" }),
      {} as never,
    );
    expect(
      textQuery.results.filter((r) => r.kind === "thread").map((r) => r.id),
    ).toEqual(["thr-meta"]);
  });

  it("keeps archived projects out of the default recent-10 cap and lists all archived projects when includeArchived is true", async () => {
    const active = Array.from({ length: 10 }, (_, i) => ({
      ...makeProject(`prj_active_${i}`, `Active ${i}`),
      updatedAt: `2026-11-10T0${i}:00:00.000Z`,
      lastOpenedAt: `2026-11-10T0${i}:00:00.000Z`,
    }));
    const archivedRecent = Array.from({ length: 3 }, (_, i) => ({
      ...makeProject(`prj_arch_recent_${i}`, `Archived Recent ${i}`),
      updatedAt: `2026-11-20T0${i}:00:00.000Z`,
      lastOpenedAt: `2026-11-20T0${i}:00:00.000Z`,
      archivedAt: "2026-11-21T00:00:00.000Z",
    }));
    const archivedUnopened = {
      ...makeProject("prj_arch_unopened", "Archived Never Opened"),
      updatedAt: "2026-11-05T00:00:00.000Z",
      lastOpenedAt: null,
      archivedAt: "2026-11-06T00:00:00.000Z",
    };
    state.listVisibleProjects.mockResolvedValue([
      ...archivedRecent,
      ...active,
      archivedUnopened,
    ]);

    const defaultRecent = await searchWorkspace.run(
      searchWorkspace.schema.parse({ text: "", projectsOnly: true }),
      {} as never,
    );
    expect(defaultRecent.results).toHaveLength(10);
    expect(defaultRecent.results.map((r) => r.id)).toEqual(
      active
        .slice()
        .reverse()
        .map((p) => p.id),
    );

    const withArchived = await searchWorkspace.run(
      searchWorkspace.schema.parse({
        text: "",
        projectsOnly: true,
        includeArchived: true,
      }),
      {} as never,
    );
    expect(withArchived.results.map((r) => r.id)).toContain(
      "prj_arch_unopened",
    );
    expect(withArchived.results).toHaveLength(14);
  });

  it("rejects malformed dateFrom and dateTo strings in schema", () => {
    expect(() =>
      searchWorkspace.schema.parse({ dateFrom: "not-a-date" }),
    ).toThrow();
    expect(() =>
      searchWorkspace.schema.parse({ dateTo: "not-a-date" }),
    ).toThrow();
    expect(
      searchWorkspace.schema.parse({
        dateFrom: "2026-11-01",
        dateTo: "2026-11-22",
      }),
    ).toMatchObject({
      dateFrom: "2026-11-01",
      dateTo: "2026-11-22",
    });
  });

  it("ranks exact title matches above title prefix matches above substring matches", async () => {
    state.listVisibleProjects.mockResolvedValue([
      {
        ...makeProject("prj_sub", "Q4 Alpha Revenue"),
        updatedAt: "2026-11-22T00:00:00.000Z",
        lastOpenedAt: null,
      },
      {
        ...makeProject("prj_prefix", "Alpha Forecast"),
        updatedAt: "2026-11-21T00:00:00.000Z",
        lastOpenedAt: null,
      },
      {
        ...makeProject("prj_exact", "Alpha"),
        updatedAt: "2026-11-20T00:00:00.000Z",
        lastOpenedAt: null,
      },
    ]);

    const output = await searchWorkspace.run(
      searchWorkspace.schema.parse({ text: "alpha", projectsOnly: true }),
      {} as never,
    );
    expect(output.results.map((r) => r.id)).toEqual([
      "prj_exact",
      "prj_prefix",
      "prj_sub",
    ]);
  });

  it("extracts the matching line as the snippet for multi-line cell matches", async () => {
    state.getReadableDoc.mockResolvedValue({
      cells: [
        {
          id: "cell-1",
          contents: {
            kind: "code",
            language: "sql",
            source:
              "SELECT id, amount\nFROM orders\nWHERE region = 'EMEA_TARGET'\nLIMIT 100",
          },
        },
      ],
    });

    const output = await searchWorkspace.run(
      searchWorkspace.schema.parse({ text: "EMEA_TARGET" }),
      {} as never,
    );

    const project = output.results.find((r) => r.kind === "project");
    expect(project?.kind).toBe("project");
    if (project?.kind === "project") {
      expect(project.cellMatches).toEqual([
        {
          cellId: "cell-1",
          cellKind: "sql",
          snippet: "WHERE region = 'EMEA_TARGET'",
        },
      ]);
    }
  });
});
