import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  write: vi.fn(),
  read: vi.fn(),
  readTab: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppStateForCurrentTab: state.write,
  readAppState: state.read,
  readAppStateForCurrentTab: state.readTab,
}));

import {
  dataBrowserHref,
  decodeScopedResourceId,
} from "../app/components/workspace/DataPageAdapter.model.js";
import {
  dataBrowserResourcePath,
  focusedResource,
  pathFromView,
} from "../app/lib/navigation-contract.js";
vi.mock("../server/lib/project-action-access.js", () => ({
  requireReadableProject: vi.fn().mockResolvedValue({ scope: {}, project: {} }),
}));
vi.mock("../server/model/project-grant-access.js", () => ({
  canEditProject: (level: string) => level === "owner" || level === "edit",
  projectAccessLevel: vi.fn().mockResolvedValue("owner"),
}));
vi.mock("./get-thread-summary.js", () => ({
  default: { run: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: vi
    .fn()
    .mockResolvedValue({ ownerEmail: "owner@example.test", orgId: "org-1" }),
  currentWorkspaceCapabilities: () => ({
    allows: (permission: string) => permission === "context-studio",
  }),
}));
vi.mock("../server/model/collections-store.js", () => ({
  listCollections: vi.fn().mockResolvedValue([
    { id: "c1", children: [] },
    { id: "abc/123", children: [] },
  ]),
}));
vi.mock("../server/model/data-connections.js", () => ({
  listDataConnections: vi
    .fn()
    .mockResolvedValue([{ id: "d1" }, { id: "abc/123" }]),
}));
vi.mock("../server/lib/recent-query-project.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/recent-query-project.js")
  >()),
  findRecentQueryProject: vi.fn().mockResolvedValue(null),
}));

import { requireReadableProject } from "../server/lib/project-action-access.js";
import { findRecentQueryProject } from "../server/lib/recent-query-project.js";
import { projectAccessLevel } from "../server/model/project-grant-access.js";
import navigate from "./navigate.js";
import viewScreen from "./view-screen.js";

describe("agent navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.readTab.mockReset();
  });

  it.each([
    ["project", "/project/abc%2F123/latest"],
    ["thread", "/thread/abc%2F123"],
    ["collection", "/collection/abc%2F123"],
    ["data-connection", "/home/data/all/data-connection/abc%2F123"],
  ] as const)(
    "opens a %s by ID and reports the focused object",
    async (kind, path) => {
      await navigate.run({ kind, id: "abc/123" }, {} as never);
      expect(state.write).toHaveBeenCalledWith(
        "navigate",
        expect.objectContaining({ path }),
      );
      expect(focusedResource(path)).toEqual({
        resourceKind: kind,
        resourceId: "abc/123",
      });
    },
  );

  it("opens a search result's local href and rejects external paths", async () => {
    await navigate.run(
      { path: "/project/found/latest?tab=logic" },
      {} as never,
    );
    expect(state.write).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ path: "/project/found/latest?tab=logic" }),
    );
    await expect(
      navigate.run({ path: "//example.test" }, {} as never),
    ).rejects.toThrow();
  });

  it("maps home section view names to canonical /home routes", () => {
    expect(pathFromView("home")).toBe("/home");
    expect(pathFromView("recent-projects")).toBe("/home");
    expect(pathFromView("all")).toBe("/home/all");
    expect(pathFromView("archive")).toBe("/home/archive");
    expect(pathFromView("archived")).toBe("/home/archive");
    expect(pathFromView("collections")).toBe("/home/collections");
    expect(pathFromView("data")).toBe("/home/data");
    expect(pathFromView("trash")).toBe("/home/trash");
    expect(pathFromView("threads")).toBe("/home/threads");
    expect(pathFromView("library")).toBe("/home/library");
    expect(pathFromView("search")).toBe("/home/search");
  });

  it("builds and decodes scoped data browser table and schema routes", () => {
    const tablePath = dataBrowserResourcePath(
      "builtin-sample-data",
      "table",
      "table:sample:PUBLIC:orders",
    );
    expect(tablePath).toBe(
      dataBrowserHref(
        "all",
        { type: "table", id: "table:sample:PUBLIC:orders" },
        "builtin-sample-data",
      ),
    );
    const segment = decodeURIComponent(tablePath.split("/").at(-1) ?? "");
    expect(decodeScopedResourceId(segment)).toEqual({
      connectionId: "builtin-sample-data",
      kind: "table",
      resourceId: "table:sample:PUBLIC:orders",
    });
    expect(focusedResource(tablePath)).toEqual({
      resourceKind: "data-connection",
      resourceId: "builtin-sample-data",
      dataResourceKind: "table",
      dataResourceId: "table:sample:PUBLIC:orders",
      dataResourceName: "orders",
      dataSchemaName: "PUBLIC",
    });

    const schemaPath = dataBrowserResourcePath(
      "builtin-sample-data",
      "schema",
      "schema:PUBLIC",
    );
    expect(schemaPath).toBe(
      dataBrowserHref(
        "all",
        { type: "schema", id: "schema:PUBLIC" },
        "builtin-sample-data",
      ),
    );
    expect(focusedResource(schemaPath)).toEqual({
      resourceKind: "data-connection",
      resourceId: "builtin-sample-data",
      dataResourceKind: "schema",
      dataResourceId: "schema:PUBLIC",
      dataResourceName: "PUBLIC",
      dataSchemaName: "PUBLIC",
    });

    expect(focusedResource("/home/data/all/table/dsr1%3Anot-json")).toEqual({
      resourceStatus: "invalid-id",
    });
  });

  it("enforces project access and unavailable-route checks when path includes mounted app prefix", async () => {
    vi.mocked(requireReadableProject).mockRejectedValueOnce(
      Object.assign(new Error("Project not found"), {
        errorCode: "project_not_found",
      }),
    );
    await expect(
      navigate.run({ path: "/analytics-2/project/missing/latest" }, {
        appId: "analytics-2",
      } as never),
    ).rejects.toMatchObject({ errorCode: "project_not_found" });
    expect(state.write).not.toHaveBeenCalled();

    await expect(
      navigate.run({ path: "/analytics-2/home/data/semantic-layer" }, {
        appId: "analytics-2",
      } as never),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "missing_backing" });
    expect(state.write).not.toHaveBeenCalled();
  });

  it("includes the current tab's selection in a refreshed screen", async () => {
    state.read.mockResolvedValue({
      view: "project",
      resourceKind: "project",
      resourceId: "p1",
    });
    state.readTab.mockImplementation(async (key: string) =>
      key === "selection"
        ? {
            kind: "cell",
            id: "c1",
            projectId: "p1",
          }
        : null,
    );
    expect(await viewScreen.run({}, {} as never)).toEqual({
      navigation: {
        view: "project",
        resourceKind: "project",
        resourceId: "p1",
      },
      selection: { kind: "cell", id: "c1", projectId: "p1" },
    });
    expect(state.readTab).toHaveBeenCalledWith("selection");
  });

  it("does not report a selection from a different project", async () => {
    state.read.mockResolvedValue({
      view: "project",
      resourceKind: "project",
      resourceId: "p2",
    });
    state.readTab.mockResolvedValue({
      kind: "cell",
      id: "c1",
      projectId: "p1",
    });
    expect(await viewScreen.run({}, {} as never)).toEqual({
      navigation: {
        view: "project",
        resourceKind: "project",
        resourceId: "p2",
      },
    });
  });

  it("report ADHOC-1117-EDITING-SNAPSHOT returns bounded current-tab drafts only for the open accessible project", async () => {
    state.read.mockResolvedValue({
      view: "project",
      resourceKind: "project",
      resourceId: "p1",
    });
    const editing = {
      projectId: "p1",
      cells: [
        {
          id: "c1",
          kind: "sql",
          text: "select unsaved",
          truncated: false,
          unsaved: true,
        },
        {
          id: "c2",
          kind: "markdown",
          text: "Draft note",
          truncated: false,
          unsaved: true,
        },
        {
          id: "c3",
          kind: "chart",
          dataframe: "df",
          chartSpec: {
            mark: "bar",
            xField: "day",
            yField: "amount",
            seriesField: null,
            title: null,
          },
          unsaved: true,
        },
      ],
      truncated: false,
    };
    state.readTab.mockImplementation(async (key: string) =>
      key === "notebook-editing" ? editing : null,
    );
    expect(await viewScreen.run({}, {} as never)).toMatchObject({ editing });
    expect(requireReadableProject).toHaveBeenCalledWith("p1");
    vi.mocked(projectAccessLevel).mockResolvedValueOnce("read");
    expect(await viewScreen.run({}, {} as never)).not.toHaveProperty("editing");
    state.readTab.mockImplementation(async (key: string) =>
      key === "notebook-editing" ? { ...editing, cells: "invalid" } : null,
    );
    await expect(viewScreen.run({}, {} as never)).rejects.toThrow();
    state.readTab.mockImplementation(async (key: string) =>
      key === "notebook-editing" ? editing : null,
    );
    state.read.mockResolvedValue({
      view: "project",
      resourceKind: "project",
      resourceId: "p2",
    });
    expect(await viewScreen.run({}, {} as never)).not.toHaveProperty("editing");
  });

  it("report K-ANA-4-1: includes recentQueryProject on /home/data when no project is open and skips it on project or published app views", async () => {
    const recent = {
      id: "prj_orders",
      title: "Orders by month — demo",
      updatedAt: "2026-11-20T11:00:00.000Z",
      sqlCells: [
        {
          id: "cel_orders",
          label: "Orders",
          sourcePreview: "SELECT * FROM orders LIMIT 100",
        },
      ],
    };
    vi.mocked(findRecentQueryProject).mockResolvedValueOnce(recent);
    state.read.mockResolvedValue({
      view: "home/data/all/data-connection/builtin-sample-data",
      path: "/analytics-2/home/data/all/data-connection/builtin-sample-data",
      resourceKind: "data-connection",
      resourceId: "builtin-sample-data",
    });
    expect(await viewScreen.run({}, {} as never)).toEqual({
      navigation: {
        view: "home/data/all/data-connection/builtin-sample-data",
        path: "/analytics-2/home/data/all/data-connection/builtin-sample-data",
        resourceKind: "data-connection",
        resourceId: "builtin-sample-data",
      },
      recentQueryProject: recent,
    });
    expect(findRecentQueryProject).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
    });

    vi.mocked(findRecentQueryProject).mockClear();
    state.read.mockResolvedValue({
      view: "app/p1/latest",
      path: "/analytics-2/app/p1/latest",
    });
    expect(await viewScreen.run({}, {} as never)).toEqual({
      navigation: {
        view: "app/p1/latest",
        path: "/analytics-2/app/p1/latest",
      },
    });
    expect(findRecentQueryProject).not.toHaveBeenCalled();
  });
});
