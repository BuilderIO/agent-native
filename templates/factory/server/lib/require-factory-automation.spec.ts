import { beforeEach, describe, expect, it, vi } from "vitest";

const listAutomationDefinitionsMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/triggers", () => ({
  listAutomationDefinitions: listAutomationDefinitionsMock,
}));

vi.mock("../db/index.js", () => ({
  getDb: getDbMock,
}));

import { requireFactoryAutomation } from "./require-factory-automation.js";

const teammateEmail = "teammate@example.com";
const nestedName = "factories/enzo-test-factory-3/factory-slack-feedback";
const nestedPath = `jobs/${nestedName}.md`;

function nestedDefinition(createdBy = teammateEmail) {
  return {
    name: nestedName,
    resource: {
      id: "resource-nested",
      path: nestedPath,
      content: "---\ndomain: factory\n---\n",
    },
    meta: {
      domain: "factory",
      orgId: "org-1",
      runAs: "creator",
      createdBy,
    },
  };
}

const governedContext = {
  caller: "automation" as const,
  automation: {
    triggerId: "resource-nested",
    triggerName: nestedName,
  },
};

function factoryLookupDb(found: boolean) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi
            .fn()
            .mockResolvedValue(found ? [{ id: "enzo-test-factory-3" }] : []),
        })),
      })),
    })),
  };
}

describe("requireFactoryAutomation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_OWNER_EMAIL = "deploy-owner@example.com";
    listAutomationDefinitionsMock.mockResolvedValue([nestedDefinition()]);
    getDbMock.mockReturnValue(factoryLookupDb(true));
  });

  it("accepts a nested Factory Slack job created by a teammate", async () => {
    await expect(
      requireFactoryAutomation(
        governedContext,
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        "enzo-test-factory-3",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects in-app chat and other tool callers", async () => {
    await expect(
      requireFactoryAutomation(
        { caller: "tool", automation: governedContext.automation },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        "enzo-test-factory-3",
      ),
    ).rejects.toThrow("This action is only available to Factory automations.");
  });

  it("rejects a nested name that is not a Factory source automation", async () => {
    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-nested",
            triggerName: "factories/enzo-test-factory-3/not-a-factory-job",
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        "enzo-test-factory-3",
      ),
    ).rejects.toThrow(
      "The action was not invoked by a governed Factory automation.",
    );
  });

  it("rejects a governed job with no createdBy", async () => {
    listAutomationDefinitionsMock.mockResolvedValue([nestedDefinition("")]);

    await expect(
      requireFactoryAutomation(
        governedContext,
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        "enzo-test-factory-3",
      ),
    ).rejects.toThrow(
      "The action was not invoked by a governed Factory automation.",
    );
  });

  it("rejects a governed job after the Factory has been deleted", async () => {
    getDbMock.mockReturnValue(factoryLookupDb(false));

    await expect(
      requireFactoryAutomation(
        governedContext,
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        "enzo-test-factory-3",
      ),
    ).rejects.toThrow("Factory not found.");
  });
});
