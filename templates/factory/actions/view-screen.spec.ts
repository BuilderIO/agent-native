import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppStateForCurrentTabMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const listFactoryDefinitionsMock = vi.hoisted(() => vi.fn());
const readFactoryDefinitionMock = vi.hoisted(() => vi.fn());
const getWorkflowMock = vi.hoisted(() => vi.fn());
const listWorkflowsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: readAppStateForCurrentTabMock,
}));

vi.mock("@agent-native/dispatch/actions", () => ({
  dispatchActions: {},
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

vi.mock("../server/lib/factory-definitions.js", () => ({
  defaultFactoryDefinition: () => ({
    id: "product-feedback",
    name: "Product feedback to shipped change",
  }),
  listFactoryDefinitions: listFactoryDefinitionsMock,
  readFactoryDefinition: readFactoryDefinitionMock,
}));

vi.mock("../server/workflow-host/factory-store.js", () => ({
  getWorkflowStore: () => ({
    getWorkflow: getWorkflowMock,
    listWorkflows: listWorkflowsMock,
  }),
}));

function navigationAnd(editor: Record<string, unknown> | null) {
  return (key: string) => {
    if (key === "workflow-editor") return Promise.resolve(editor);
    return Promise.resolve(navigationState);
  };
}

let navigationState: Record<string, unknown> | null = null;

function openFactoryState(extra: Record<string, unknown> = {}) {
  navigationState = {
    view: "factory",
    factoryId: "company-demo",
    factoryTab: "workflows",
    ...extra,
  };
}

const workflowRecord = {
  id: "wf-1",
  name: "Bug report to Builder",
  version: 5,
  enabled: true,
  lastCleanDryRunVersion: 5,
  graph: {
    nodes: [
      { id: "trigger", name: "Every 5 minutes", kind: "trigger" },
      { id: "assess", name: "Assess", kind: "ai" },
    ],
    edges: [
      {
        id: "e1",
        from: { node: "trigger", port: "out" },
        to: { node: "assess" },
      },
    ],
    settings: {},
  },
};

describe("view-screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationState = null;
    readAppStateForCurrentTabMock.mockImplementation(navigationAnd(null));
    requireWorkspaceMemberMock.mockResolvedValue({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    workspaceMemberIdentityFromContextMock.mockReturnValue({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    readFactoryDefinitionMock.mockResolvedValue({
      id: "company-demo",
      name: "Company demo",
    });
  });

  it("returns the factory list when no factory is open", async () => {
    navigationState = { view: "factory", path: "/factory" };
    readAppStateForCurrentTabMock.mockImplementation(navigationAnd(null));
    listFactoryDefinitionsMock.mockResolvedValue([
      { id: "company-demo", name: "Company demo" },
    ]);

    const { default: action } = await import("./view-screen.js");
    const result = await action.run({}, { userEmail: "owner@example.com" });

    expect(result).toMatchObject({
      surface: "factory-list",
      factories: [
        { id: "product-feedback", name: "Product feedback to shipped change" },
        { id: "company-demo", name: "Company demo" },
      ],
    });
    expect(readFactoryDefinitionMock).not.toHaveBeenCalled();
    expect(listWorkflowsMock).not.toHaveBeenCalled();
  });

  it("lists the workflows on the default factory tab", async () => {
    navigationState = { view: "factory", factoryId: "company-demo" };
    listWorkflowsMock.mockResolvedValue({
      items: [
        {
          id: "wf-1",
          name: "Bug report to Builder",
          version: 5,
          enabled: true,
          graph: "ignored",
        },
        { id: "wf-2", name: "Morning digest", version: 1, enabled: false },
      ],
      hasMore: true,
    });

    const { default: action } = await import("./view-screen.js");
    const result = await action.run({}, { userEmail: "owner@example.com" });

    expect(result).toMatchObject({
      factory: {
        id: "company-demo",
        name: "Company demo",
        tab: "workflows",
        workflows: [
          {
            id: "wf-1",
            name: "Bug report to Builder",
            version: 5,
            enabled: true,
          },
          { id: "wf-2", name: "Morning digest", version: 1, enabled: false },
        ],
        workflowsHasMore: true,
      },
    });
    expect(listWorkflowsMock).toHaveBeenCalledWith(
      { orgId: "org-1", factoryId: "company-demo" },
      { limit: 25 },
    );
    expect(JSON.stringify(result)).not.toContain("ignored");
  });

  it("reports the open workflow, the selected step and run, and the page's unsaved state", async () => {
    openFactoryState({ workflowId: "wf-1", nodeId: "assess", runId: "run-9" });
    getWorkflowMock.mockResolvedValue(workflowRecord);
    readAppStateForCurrentTabMock.mockImplementation(
      navigationAnd({
        workflowId: "wf-1",
        baseVersion: 5,
        dirty: true,
        saving: false,
        issueCount: 12,
        issues: Array.from({ length: 12 }, (_, i) => ({
          code: "port_leads_nowhere",
          nodeId: `n${i}`,
        })),
        selection: { nodeIds: ["assess"], edgeIds: [] },
      }),
    );

    const { default: action } = await import("./view-screen.js");
    const result = (await action.run(
      {},
      { userEmail: "owner@example.com" },
    )) as {
      factory: { workflow: Record<string, any> };
    };

    expect(getWorkflowMock).toHaveBeenCalledWith(
      { orgId: "org-1", factoryId: "company-demo" },
      "wf-1",
    );
    expect(result.factory.workflow).toMatchObject({
      id: "wf-1",
      name: "Bug report to Builder",
      version: 5,
      enabled: true,
      dryRunCurrent: true,
      nodeCount: 2,
      edgeCount: 1,
      selection: {
        nodeId: "assess",
        nodeName: "Assess",
        nodeKind: "ai",
        runId: "run-9",
      },
      editor: {
        baseVersion: 5,
        dirty: true,
        saving: false,
        problemCount: 12,
        selectedNodeIds: ["assess"],
      },
    });
    // The problems are bounded, and the graph itself is never returned.
    expect(result.factory.workflow.editor.problems).toHaveLength(10);
    expect(result.factory.workflow).not.toHaveProperty("graph");
  });

  it("says a selected step is not in the graph rather than inventing one", async () => {
    openFactoryState({ workflowId: "wf-1", nodeId: "ghost" });
    getWorkflowMock.mockResolvedValue(workflowRecord);

    const { default: action } = await import("./view-screen.js");
    const result = (await action.run(
      {},
      { userEmail: "owner@example.com" },
    )) as {
      factory: { workflow: Record<string, any> };
    };

    expect(result.factory.workflow.selection).toEqual({
      nodeId: "ghost",
      nodeInGraph: false,
    });
    expect(result.factory.workflow).not.toHaveProperty("editor");
  });

  it("ignores the page state of a different workflow", async () => {
    openFactoryState({ workflowId: "wf-1" });
    getWorkflowMock.mockResolvedValue(workflowRecord);
    readAppStateForCurrentTabMock.mockImplementation(
      navigationAnd({ workflowId: "wf-other", dirty: true, issueCount: 3 }),
    );

    const { default: action } = await import("./view-screen.js");
    const result = (await action.run(
      {},
      { userEmail: "owner@example.com" },
    )) as {
      factory: { workflow: Record<string, any> };
    };

    expect(result.factory.workflow).not.toHaveProperty("editor");
  });

  it("says when the open workflow does not exist", async () => {
    openFactoryState({ workflowId: "wf-gone" });
    getWorkflowMock.mockResolvedValue(null);

    const { default: action } = await import("./view-screen.js");
    const result = await action.run({}, { userEmail: "owner@example.com" });

    expect(result).toMatchObject({
      factory: { workflow: { id: "wf-gone", found: false } },
    });
  });

  it("reports an unreadable workflow store as an error, not as an empty list", async () => {
    openFactoryState();
    listWorkflowsMock.mockRejectedValue(new Error("stored record is corrupt"));

    const { default: action } = await import("./view-screen.js");
    const result = (await action.run(
      {},
      { userEmail: "owner@example.com" },
    )) as {
      factory: Record<string, unknown>;
    };

    expect(result.factory.workflowsReadError).toBe("stored record is corrupt");
    expect(result.factory).not.toHaveProperty("workflows");
  });

  it("reports the selected item on the Items tab and reads no workflows", async () => {
    navigationState = {
      view: "factory",
      factoryId: "company-demo",
      factoryTab: "items",
      factoryItemId: "item-4",
    };

    const { default: action } = await import("./view-screen.js");
    const result = await action.run({}, { userEmail: "owner@example.com" });

    expect(result).toMatchObject({
      factory: { tab: "items", selectedItemId: "item-4" },
    });
    expect(listWorkflowsMock).not.toHaveBeenCalled();
    expect(getWorkflowMock).not.toHaveBeenCalled();
  });
});
