import { beforeEach, describe, expect, it, vi } from "vitest";

const findDefinitionMock = vi.hoisted(() => vi.fn());
const workflowStoreHolder = vi.hoisted(() => ({
  store: undefined as unknown,
}));

vi.mock("./factory-automation-resources.js", () => ({
  findFactoryAutomationDefinition: findDefinitionMock,
  factoryIdFromAutomationName: (name: string) =>
    name.match(/^factories\/([^/]+)\//)?.[1] ?? null,
}));

vi.mock("../workflow-host/factory-store.js", () => ({
  getWorkflowStore: () => workflowStoreHolder.store,
}));

import { STORY_GRAPHS } from "../workflow/story-graphs.fixture.js";
import { createInMemoryWorkflowStore } from "../workflow/testing/in-memory-store.js";
import { readCallingFactoryAutomation } from "./factory-automation-caller.js";

const identity = { userEmail: "owner@example.test", orgId: "org-1" };
const context = {
  caller: "automation" as const,
  automation: {
    triggerId: "job-1",
    triggerName: "factories/factory-1/some-job",
  },
};

describe("readCallingFactoryAutomation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowStoreHolder.store = createInMemoryWorkflowStore();
  });

  it("reads the calling job's config", async () => {
    findDefinitionMock.mockResolvedValue({
      name: "factories/factory-1/some-job",
      resource: { content: "---\nsource: slack\n---\n" },
    });

    await expect(
      readCallingFactoryAutomation(context, identity),
    ).resolves.toMatchObject({
      name: "factories/factory-1/some-job",
      config: { source: "slack" },
    });
  });

  it("answers null for a caller that is not an automation", async () => {
    await expect(
      readCallingFactoryAutomation({ caller: "frontend" }, identity),
    ).resolves.toBeNull();
  });

  it("answers null when a job that has no saved workflow cannot be found", async () => {
    findDefinitionMock.mockResolvedValue(null);

    await expect(
      readCallingFactoryAutomation(context, identity),
    ).resolves.toBeNull();
  });

  it("fails, rather than answering null, when a job that has a saved workflow cannot be found", async () => {
    findDefinitionMock.mockResolvedValue(null);
    await (
      workflowStoreHolder.store as ReturnType<
        typeof createInMemoryWorkflowStore
      >
    ).createWorkflow(
      { orgId: "org-1", factoryId: "factory-1" },
      {
        name: "Flow",
        ownerEmail: identity.userEmail,
        automationId: "job-1",
        graph: STORY_GRAPHS["morning-digest"],
      },
    );

    await expect(
      readCallingFactoryAutomation(context, identity),
    ).rejects.toMatchObject({
      errorCode: "workflow_automation_unresolved",
      statusCode: 409,
    });
  });
});
