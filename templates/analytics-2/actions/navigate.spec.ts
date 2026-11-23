import { beforeEach, describe, expect, it, vi } from "vitest";

const writeMock = vi.hoisted(() => vi.fn());
const tabMock = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppStateForCurrentTab: writeMock,
  resolveCurrentRequestStateTab: tabMock,
}));

vi.mock("../server/lib/project-action-access.js", () => ({
  requireReadableProject: vi.fn().mockResolvedValue({}),
}));
vi.mock("./get-thread-summary.js", () => ({
  default: { run: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../server/lib/analytics-capabilities.js", () => ({
  requireCapability: vi.fn().mockResolvedValue({ status: "allowed" }),
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: vi
    .fn()
    .mockResolvedValue({ ownerEmail: "owner@example.test", orgId: "org-1" }),
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

vi.mock("../server/model/projects-store.js", () => ({
  listWorkspaceVisibleProjects: vi.fn().mockResolvedValue([
    { id: "prj_orders", title: "Orders by month - demo", archivedAt: null },
    { id: "prj_other", title: "Revenue", archivedAt: null },
  ]),
}));

import navigate from "./navigate.js";

describe("navigate", () => {
  beforeEach(() => {
    writeMock.mockReset();
    tabMock.mockReset();
    tabMock.mockResolvedValue({ tabId: "tab-1" });
  });

  it.each([
    [{ projectId: "p1" }, "/project/p1/latest"],
    [{ threadId: "t1" }, "/thread/t1"],
    [{ collectionId: "c1" }, "/collection/c1"],
    [{ dataConnectionId: "d1" }, "/home/data/all/data-connection/d1"],
    [{ kind: "project", id: "p2" }, "/project/p2/latest"],
  ] as const)("opens %j from its id", async (args, path) => {
    expect(await navigate.run(args)).toMatchObject({ path });
    expect(writeMock).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ path }),
    );
  });

  it("opens declared manifest screens through existing access checks", async () => {
    expect(
      await navigate.run({ screen: "project", params: { projectId: "p1" } }),
    ).toMatchObject({ path: "/project/p1/latest" });
    expect(await navigate.run({ screen: "home" })).toMatchObject({
      path: "/home",
    });
    await expect(navigate.run({ screen: "project" })).rejects.toMatchObject({
      errorCode: "invalid_navigation",
    });
    await expect(
      navigate.run({ screen: "home", projectId: "p1" }),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation" });
  });

  it("opens a project named by title, not a made-up id", async () => {
    expect(
      await navigate.run({ projectTitle: "orders by month - demo" }),
    ).toMatchObject({ path: "/project/prj_orders/latest" });
    expect(writeMock).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ path: "/project/prj_orders/latest" }),
    );
  });

  it("refuses an unknown project title instead of navigating", async () => {
    await expect(
      navigate.run({ projectTitle: "No such project" }),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation" });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it.each([
    [{}, "dataConnectionId"],
    [{ kind: "project" }, "kind and id"],
    [{ projectId: "p1", threadId: "t1" }, "not several"],
    [{ projectId: "p1", kind: "thread", id: "t1" }, "not both"],
  ] as const)("refuses %j with a typed error", async (args, text) => {
    await expect(navigate.run(args)).rejects.toMatchObject({
      errorCode: "invalid_navigation",
      message: expect.stringContaining(text),
    });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("refuses an agent call with no browser tab instead of reporting a request", async () => {
    tabMock.mockResolvedValue({ tabId: undefined, unavailable: true });
    await expect(
      navigate.run({ path: "/home/data" }, { caller: "mcp" } as never),
    ).rejects.toMatchObject({ errorCode: "browser_tab_missing" });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("opens the path for an agent call that has a browser tab", async () => {
    expect(
      await navigate.run({ path: "/home/data" }, { caller: "mcp" } as never),
    ).toMatchObject({ path: "/home/data" });
    expect(writeMock).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ path: "/home/data" }),
    );
  });

  it.each([
    [{ view: "home" }, "/home"],
    [{ view: "recent" }, "/home"],
    [{ view: "recent-projects" }, "/home"],
    [{ view: "all" }, "/home/all"],
    [{ view: "projects" }, "/home/all"],
    [{ view: "archive" }, "/home/archive"],
    [{ view: "archived" }, "/home/archive"],
    [{ view: "trash" }, "/home/trash"],
    [{ view: "data" }, "/home/data"],
    [{ view: "threads" }, "/home/threads"],
    [{ view: "collections" }, "/home/collections"],
    [{ view: "library" }, "/home/library"],
    [{ view: "search" }, "/home/search"],
    [{ path: "/archive" }, "/home/archive"],
    [{ path: "/archived" }, "/home/archive"],
    [{ path: "/home/archived" }, "/home/archive"],
    [{ path: "/archive?sort=recent" }, "/home/archive?sort=recent"],
    [{ path: "/projects" }, "/home/all"],
    [{ path: "/analytics-2/home" }, "/home"],
    [{ path: "/analytics-2/home/archive" }, "/home/archive"],
  ] as const)(
    "resolves %j to canonical home route %s",
    async (args, expectedPath) => {
      expect(
        await navigate.run(args, {
          caller: "mcp",
          appId: "analytics-2",
        } as never),
      ).toMatchObject({ path: expectedPath });
      expect(writeMock).toHaveBeenCalledWith(
        "navigate",
        expect.objectContaining({ path: expectedPath }),
      );
    },
  );

  it("opens a scoped table or schema detail in the data browser", async () => {
    const tableResult = await navigate.run(
      {
        dataConnectionId: "d1",
        tableId: "table:sample:PUBLIC:orders",
        intent: "open",
      },
      { caller: "mcp" } as never,
    );
    expect(tableResult).toMatchObject({
      path: "/home/data/all/table/dsr1%3A%255B%2522d1%2522%252C%2522table%2522%252C%2522table%253Asample%253APUBLIC%253Aorders%2522%255D",
    });
    expect(writeMock).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ path: (tableResult as { path: string }).path }),
    );

    const schemaResult = await navigate.run(
      {
        dataConnectionId: "d1",
        schemaId: "schema:PUBLIC",
        intent: "open",
      },
      { caller: "mcp" } as never,
    );
    expect(schemaResult).toMatchObject({
      path: "/home/data/all/schema/dsr1%3A%255B%2522d1%2522%252C%2522schema%2522%252C%2522schema%253APUBLIC%2522%255D",
    });
  });

  it.each([
    [{ tableId: "table:sample:PUBLIC:orders" }, "dataConnectionId"],
    [{ schemaId: "schema:PUBLIC" }, "dataConnectionId"],
    [
      {
        dataConnectionId: "d1",
        tableId: "table:sample:PUBLIC:orders",
        schemaId: "schema:PUBLIC",
      },
      "not both",
    ],
    [{ dataConnectionId: "d1", tableId: ".." }, "identify a resource"],
  ] as const)(
    "refuses invalid table/schema navigation %j",
    async (args, text) => {
      await expect(navigate.run(args)).rejects.toMatchObject({
        errorCode: "invalid_navigation",
        message: expect.stringContaining(text),
      });
      expect(writeMock).not.toHaveBeenCalled();
    },
  );
});
