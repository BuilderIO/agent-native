import { beforeEach, describe, expect, it, vi } from "vitest";

const listFactoryAutomationDefinitionsMock = vi.hoisted(() => vi.fn());
const readFactoryDefinitionMock = vi.hoisted(() => vi.fn());
const listAutomationDefinitionsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/triggers", () => ({
  listAutomationDefinitions: listAutomationDefinitionsMock,
}));

vi.mock("../factory-graph/store.js", () => ({
  DEFAULT_FACTORY_ID: "product-feedback",
  readFactoryDefinition: readFactoryDefinitionMock,
}));

vi.mock("./factory-automation-resources.js", () => ({
  listFactoryAutomationDefinitions: listFactoryAutomationDefinitionsMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  readFactoryDefinitionMock.mockResolvedValue({ id: "demo-factory" });
  listFactoryAutomationDefinitionsMock.mockResolvedValue([]);
});

describe("listFactoryAutomationPreview", () => {
  it("uses the Factory-prefix list and keeps jobs that lost domain", async () => {
    listFactoryAutomationDefinitionsMock.mockResolvedValue([
      {
        name: "factories/demo-factory/factory-slack-feedback",
        resource: {
          id: "resource-slim",
          content: "---\nenabled: true\nsource: slack\n---\nObserve Slack.\n",
        },
        meta: { enabled: true },
      },
    ]);

    const { listFactoryAutomationPreview } =
      await import("./factory-automation-preview.js");
    await expect(
      listFactoryAutomationPreview("user@example.com", "org-1", "demo-factory"),
    ).resolves.toEqual([
      {
        id: "resource-slim",
        displayName: "factories/demo-factory/factory-slack-feedback",
        source: "slack",
        enabled: true,
      },
    ]);
    expect(listFactoryAutomationDefinitionsMock).toHaveBeenCalledWith(
      "org-1",
      "demo-factory",
    );
    expect(listAutomationDefinitionsMock).not.toHaveBeenCalled();
  });

  it("returns no jobs for an unknown named Factory", async () => {
    readFactoryDefinitionMock.mockResolvedValue(undefined);

    const { listFactoryAutomationPreview } =
      await import("./factory-automation-preview.js");
    await expect(
      listFactoryAutomationPreview("user@example.com", "org-1", "missing"),
    ).resolves.toEqual([]);
    expect(listFactoryAutomationDefinitionsMock).not.toHaveBeenCalled();
  });
});
