import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppStateForCurrentTabMock = vi.hoisted(() => vi.fn());
const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const listFactoryDefinitionsMock = vi.hoisted(() => vi.fn());
const listFactoryInboxPreviewMock = vi.hoisted(() => vi.fn());
const readFactoryDefinitionMock = vi.hoisted(() => vi.fn());
const parseFactoryGraphMock = vi.hoisted(() => vi.fn());
const listFactoryAutomationPreviewMock = vi.hoisted(() => vi.fn());

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

vi.mock("../server/lib/factory-automation-preview.js", () => ({
  listFactoryAutomationPreview: listFactoryAutomationPreviewMock,
}));

vi.mock("../server/factory-graph/store.js", () => ({
  DEFAULT_FACTORY_ID: "product-feedback",
  defaultFactoryDefinition: () => ({
    id: "product-feedback",
    name: "Product feedback to shipped change",
    graph: { version: 1, nodes: [], edges: [] },
  }),
  listFactoryDefinitions: listFactoryDefinitionsMock,
  listFactoryInboxPreview: listFactoryInboxPreviewMock,
  parseFactoryGraph: parseFactoryGraphMock,
  readFactoryDefinition: readFactoryDefinitionMock,
}));

describe("view-screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireWorkspaceMemberMock.mockResolvedValue({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
    workspaceMemberIdentityFromContextMock.mockReturnValue({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
  });

  it("returns the factory list when no factory is open", async () => {
    readAppStateForCurrentTabMock.mockResolvedValue({
      view: "factory",
      path: "/factory",
    });
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
    expect(result).not.toHaveProperty("factory.graphVersion");
    expect(readFactoryDefinitionMock).not.toHaveBeenCalled();
  });

  it("returns inbox preview on the default factory tab", async () => {
    readAppStateForCurrentTabMock.mockResolvedValue({
      view: "factory",
      factoryId: "company-demo",
    });
    readFactoryDefinitionMock.mockResolvedValue({
      id: "company-demo",
      name: "Company demo",
    });
    listFactoryInboxPreviewMock.mockResolvedValue({
      itemCount: 0,
      items: [],
    });

    const { default: action } = await import("./view-screen.js");
    const result = await action.run({}, { userEmail: "owner@example.com" });

    expect(result).toMatchObject({
      factory: {
        id: "company-demo",
        name: "Company demo",
        tab: "inbox",
        inbox: { itemCount: 0, items: [] },
      },
    });
    expect(parseFactoryGraphMock).not.toHaveBeenCalled();
  });

  it("returns map selection only on the Map tab", async () => {
    readAppStateForCurrentTabMock.mockResolvedValue({
      view: "factory",
      factoryId: "company-demo",
      factoryTab: "map",
      factoryNodeId: "start",
    });
    readFactoryDefinitionMock.mockResolvedValue({
      id: "company-demo",
      name: "Company demo",
      graphVersion: 1,
      graphJson: "{}",
    });
    parseFactoryGraphMock.mockReturnValue({
      version: 1,
      nodes: [{ id: "start", label: "Start" }],
      edges: [],
    });

    const { default: action } = await import("./view-screen.js");
    const result = await action.run({}, { userEmail: "owner@example.com" });

    expect(result).toMatchObject({
      factory: {
        id: "company-demo",
        name: "Company demo",
        tab: "map",
        graphVersion: 1,
        selectedNode: { id: "start", label: "Start" },
      },
    });
    expect(listFactoryInboxPreviewMock).not.toHaveBeenCalled();
  });

  it("returns the job list on the Automations tab", async () => {
    readAppStateForCurrentTabMock.mockResolvedValue({
      view: "factory",
      factoryId: "company-demo",
      factoryTab: "automations",
    });
    readFactoryDefinitionMock.mockResolvedValue({
      id: "company-demo",
      name: "Company demo",
    });
    listFactoryAutomationPreviewMock.mockResolvedValue([
      {
        id: "job-1",
        displayName: "Slack bugs",
        source: "slack",
        enabled: false,
      },
    ]);

    const { default: action } = await import("./view-screen.js");
    const result = await action.run({}, { userEmail: "owner@example.com" });

    expect(result).toMatchObject({
      factory: {
        id: "company-demo",
        name: "Company demo",
        tab: "automations",
        automations: [
          {
            id: "job-1",
            displayName: "Slack bugs",
            source: "slack",
            enabled: false,
          },
        ],
      },
    });
    expect(parseFactoryGraphMock).not.toHaveBeenCalled();
  });
});
