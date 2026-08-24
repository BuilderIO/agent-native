import { beforeEach, describe, expect, it, vi } from "vitest";

const listAutomationDefinitionsMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/triggers", () => ({
  listAutomationDefinitions: listAutomationDefinitionsMock,
}));

import { requireFactoryAutomation } from "./require-factory-automation.js";

const ownerEmail = "owner@example.com";
const nestedName = "factories/enzo-test-factory-3/factory-slack-feedback";
const nestedPath = `jobs/${nestedName}.md`;

function nestedDefinition() {
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
      createdBy: ownerEmail,
    },
  };
}

describe("requireFactoryAutomation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_OWNER_EMAIL = ownerEmail;
    listAutomationDefinitionsMock.mockResolvedValue([nestedDefinition()]);
  });

  it("accepts nested Factory Slack automations for source polling", async () => {
    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-nested",
            triggerName: nestedName,
          },
        },
        { userEmail: ownerEmail, orgId: "org-1" },
        "sourcePolling",
        "enzo-test-factory-3",
      ),
    ).resolves.toBeUndefined();
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
        { userEmail: ownerEmail, orgId: "org-1" },
        "sourcePolling",
        "enzo-test-factory-3",
      ),
    ).rejects.toThrow(
      "The action was not invoked by a governed Factory automation.",
    );
  });
});
