import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceListContentMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/resources", () => ({
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceListContentByOwnersAndPrefixes: resourceListContentMock,
}));

import {
  factoryIdFromAutomationName,
  findFactoryAutomationDefinition,
  listFactoryAutomationDefinitions,
} from "./factory-automation-resources.js";

beforeEach(() => {
  vi.clearAllMocks();
  resourceListContentMock.mockResolvedValue([]);
});

describe("listFactoryAutomationDefinitions", () => {
  it("returns a nested factory job that lost its catalog tags", async () => {
    const resource = {
      id: "resource-slim",
      owner: "__organization__:org-1",
      path: "jobs/factories/demo-factory/factory-slack-feedback.md",
      content: "---\nenabled: true\nlastStatus: running\n---\nObserve Slack.\n",
      updatedAt: 1,
    };
    resourceListContentMock.mockResolvedValue([resource]);

    const definitions = await listFactoryAutomationDefinitions(
      "org-1",
      "demo-factory",
    );

    expect(definitions).toEqual([
      expect.objectContaining({
        name: "factories/demo-factory/factory-slack-feedback",
        meta: expect.objectContaining({ enabled: true }),
      }),
    ]);
    expect(definitions[0]?.meta.domain).toBeUndefined();
    expect(definitions[0]?.meta.triggerType).toBeUndefined();
    expect(resourceListContentMock).toHaveBeenCalledWith(
      ["__organization__:org-1"],
      ["jobs/factories/demo-factory/"],
    );
  });

  it("includes default-factory jobs/factory-*.md files", async () => {
    const resource = {
      id: "resource-default",
      owner: "__organization__:org-1",
      path: "jobs/factory-pr-babysit.md",
      content: "---\nenabled: true\n---\nBabysit PRs.\n",
      updatedAt: 1,
    };
    resourceListContentMock.mockImplementation(
      async (_owners: string[], prefixes: string[]) =>
        prefixes.includes("jobs/factory-") ? [resource] : [],
    );

    const definitions = await listFactoryAutomationDefinitions(
      "org-1",
      "product-feedback",
    );

    expect(definitions.map((entry) => entry.name)).toEqual([
      "factory-pr-babysit",
    ]);
  });

  it("includes custom-named jobs in the factory folder", async () => {
    const resource = {
      id: "resource-custom",
      owner: "__organization__:org-1",
      path: "jobs/factories/demo-factory/my-slack-watch.md",
      content: "---\nenabled: true\n---\nObserve Slack.\n",
      updatedAt: 1,
    };
    resourceListContentMock.mockResolvedValue([resource]);

    const definitions = await listFactoryAutomationDefinitions(
      "org-1",
      "demo-factory",
    );

    expect(definitions.map((entry) => entry.name)).toEqual([
      "factories/demo-factory/my-slack-watch",
    ]);
  });

  it("excludes a job that declares a different app owner", async () => {
    const resource = {
      id: "resource-calendar",
      owner: "__organization__:org-1",
      path: "jobs/factories/demo-factory/calendar-digest.md",
      content: "---\nenabled: true\nappId: calendar\n---\nSend the digest.\n",
      updatedAt: 1,
    };
    resourceListContentMock.mockResolvedValue([resource]);

    await expect(
      listFactoryAutomationDefinitions("org-1", "demo-factory"),
    ).resolves.toEqual([]);
  });

  it("excludes a job whose declared orgId does not match its owner", async () => {
    const resource = {
      id: "resource-mismatched-org",
      owner: "__organization__:org-1",
      path: "jobs/factories/demo-factory/factory-slack-feedback.md",
      content: "---\nenabled: true\norgId: org-2\n---\nObserve Slack.\n",
      updatedAt: 1,
    };
    resourceListContentMock.mockResolvedValue([resource]);

    await expect(
      listFactoryAutomationDefinitions("org-1", "demo-factory"),
    ).resolves.toEqual([]);
  });

  it("finds a slim job by resource id", async () => {
    const resource = {
      id: "resource-slim",
      owner: "__organization__:org-1",
      path: "jobs/factories/demo-factory/factory-slack-feedback.md",
      content: "---\nenabled: true\n---\nObserve Slack.\n",
      updatedAt: 1,
    };
    resourceListContentMock.mockResolvedValue([resource]);

    await expect(
      findFactoryAutomationDefinition("org-1", "demo-factory", "resource-slim"),
    ).resolves.toEqual(
      expect.objectContaining({
        name: "factories/demo-factory/factory-slack-feedback",
      }),
    );
  });
});

describe("factoryIdFromAutomationName", () => {
  it("reads nested and default-factory names", () => {
    expect(
      factoryIdFromAutomationName(
        "factories/demo-factory/factory-slack-feedback",
      ),
    ).toBe("demo-factory");
    expect(factoryIdFromAutomationName("factory-pr-babysit")).toBe(
      "product-feedback",
    );
  });
});

describe("listFactoryAutomationDefinitions isolation", () => {
  it("does not attribute another factory's nested job to this factory", async () => {
    const resource = {
      id: "resource-other",
      owner: "__organization__:org-1",
      path: "jobs/factories/other-factory/factory-slack-feedback.md",
      content: "---\nenabled: true\n---\nObserve Slack.\n",
      updatedAt: 1,
    };
    resourceListContentMock.mockResolvedValue([resource]);

    await expect(
      listFactoryAutomationDefinitions("org-1", "demo-factory"),
    ).resolves.toEqual([]);
  });
});
