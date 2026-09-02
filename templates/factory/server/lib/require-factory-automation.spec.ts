import { beforeEach, describe, expect, it, vi } from "vitest";

const findFactoryAutomationDefinitionMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("./factory-automation-resources.js", () => ({
  findFactoryAutomationDefinition: findFactoryAutomationDefinitionMock,
  factoryIdFromAutomationName: (name: string) => {
    const nested = name.match(/^factories\/([^/]+)\//);
    if (nested?.[1]) return nested[1];
    if (/^factory-[^/]+$/.test(name)) return "product-feedback";
    return null;
  },
}));

vi.mock("../db/index.js", () => ({
  getDb: getDbMock,
}));

import { requireFactoryAutomation } from "./require-factory-automation.js";

const teammateEmail = "teammate@example.com";
const factoryId = "enzo-test-factory-3";

function nestedJob(leafName: string, createdBy = teammateEmail) {
  const name = `factories/${factoryId}/${leafName}`;
  return {
    name,
    resource: {
      id: `resource-${leafName}`,
      path: `jobs/${name}.md`,
      content: "---\ndomain: factory\n---\n",
    },
    meta: {
      domain: "factory",
      orgId: "org-1",
      runAs: "creator" as const,
      createdBy,
    },
  };
}

function governedContext(leafName: string) {
  const definition = nestedJob(leafName);
  return {
    caller: "automation" as const,
    automation: {
      triggerId: definition.resource.id,
      triggerName: definition.name,
    },
  };
}

function factoryLookupDb(found: boolean) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(found ? [{ id: factoryId }] : []),
        })),
      })),
    })),
  };
}

describe("requireFactoryAutomation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_OWNER_EMAIL = "deploy-owner@example.com";
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      nestedJob("factory-slack-feedback"),
    );
    getDbMock.mockReturnValue(factoryLookupDb(true));
  });

  it("accepts a blank Slack job by source frontmatter", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: `factories/${factoryId}/factory-slack-custom`,
      body: "",
      resource: {
        id: "resource-factory-slack-custom",
        path: `jobs/factories/${factoryId}/factory-slack-custom.md`,
        content: "---\ndomain: factory\nsource: slack\n---\n",
      },
      meta: {
        domain: "factory",
        orgId: "org-1",
        runAs: "creator" as const,
        createdBy: teammateEmail,
      },
    });
    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-factory-slack-custom",
            triggerName: `factories/${factoryId}/factory-slack-custom`,
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts a nested Factory Slack job created by a teammate", async () => {
    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts nested GitHub issue, governance, and babysit jobs for githubPolling", async () => {
    for (const leafName of [
      "factory-github-issues",
      "factory-pr-governance",
      "factory-pr-babysit",
    ] as const) {
      findFactoryAutomationDefinitionMock.mockResolvedValue(
        nestedJob(leafName),
      );
      await expect(
        requireFactoryAutomation(
          governedContext(leafName),
          { userEmail: teammateEmail, orgId: "org-1" },
          "githubPolling",
          factoryId,
        ),
      ).resolves.toBeUndefined();
    }
  });

  it("rejects in-app chat and other tool callers", async () => {
    await expect(
      requireFactoryAutomation(
        {
          caller: "tool",
          automation: governedContext("factory-slack-feedback").automation,
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).rejects.toThrow("This action is only available to Factory automations.");
  });

  it("rejects a nested name that is not a Factory source automation", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      nestedJob("not-a-factory-job"),
    );
    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-not-a-factory-job",
            triggerName: `factories/${factoryId}/not-a-factory-job`,
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).rejects.toThrow(
      `factories/${factoryId}/not-a-factory-job is not allowed to call this action (sourcePolling).`,
    );
  });

  it("rejects PR babysit from Slack/Sentry source polling", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      nestedJob("factory-pr-babysit"),
    );

    await expect(
      requireFactoryAutomation(
        governedContext("factory-pr-babysit"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).rejects.toThrow(
      `factories/${factoryId}/factory-pr-babysit is not allowed to call this action (sourcePolling).`,
    );
  });

  it("rejects Slack feedback from GitHub polling", async () => {
    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "githubPolling",
        factoryId,
      ),
    ).rejects.toThrow(
      `factories/${factoryId}/factory-slack-feedback is not allowed to call this action (githubPolling).`,
    );
  });

  it("rejects a governed job with no createdBy", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      nestedJob("factory-slack-feedback", ""),
    );

    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).rejects.toThrow(
      `factories/${factoryId}/factory-slack-feedback is not a governed Factory automation (sourcePolling).`,
    );
  });

  it("rejects a governed job for a different factory", async () => {
    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        "other-factory",
      ),
    ).rejects.toThrow(
      `factories/${factoryId}/factory-slack-feedback is not the governed Factory automation for this factory (sourcePolling).`,
    );
  });

  it("rejects a governed job after the Factory has been deleted", async () => {
    getDbMock.mockReturnValue(factoryLookupDb(false));

    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).rejects.toThrow("Factory not found.");
  });

  it("accepts a factory-folder job that lost domain and triggerType", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: `factories/${factoryId}/factory-slack-feedback`,
      body: "Observe Slack.",
      resource: {
        id: "resource-slim",
        path: `jobs/factories/${factoryId}/factory-slack-feedback.md`,
        content: "---\nenabled: true\ncreatedBy: teammate@example.com\n---\n",
      },
      meta: {
        createdBy: teammateEmail,
      },
    });

    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-slim",
            triggerName: `factories/${factoryId}/factory-slack-feedback`,
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts a custom-named factory-folder job", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: `factories/${factoryId}/my-slack-watch`,
      body: "Observe Slack.",
      resource: {
        id: "resource-custom",
        path: `jobs/factories/${factoryId}/my-slack-watch.md`,
        content:
          "---\nenabled: true\ncreatedBy: teammate@example.com\nsource: slack\n---\n",
      },
      meta: {
        createdBy: teammateEmail,
      },
    });

    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-custom",
            triggerName: `factories/${factoryId}/my-slack-watch`,
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts the virtual default Factory when no definition row exists", async () => {
    getDbMock.mockReturnValue(factoryLookupDb(false));
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: "factory-slack-feedback",
      body: "",
      resource: {
        id: "resource-default",
        path: "jobs/factory-slack-feedback.md",
        content: "---\ndomain: factory\n---\n",
      },
      meta: {
        domain: "factory",
        orgId: "org-1",
        runAs: "creator",
        createdBy: teammateEmail,
      },
    });

    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-default",
            triggerName: "factory-slack-feedback",
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        "product-feedback",
      ),
    ).resolves.toBeUndefined();
  });
});
