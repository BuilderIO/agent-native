import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteAutomationRunsMock = vi.hoisted(() => vi.fn());
const listAutomationDefinitionsMock = vi.hoisted(() => vi.fn());
const resourceDeleteByPathMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourceListMock = vi.hoisted(() => vi.fn());
const resourceListContentMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const recordFactoryGovernanceAuditMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const recordFactoryAutomationRunPromptMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

const insertAutomationVersionValuesMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("../triage/audit.js", () => ({
  recordFactoryGovernanceAudit: recordFactoryGovernanceAuditMock,
  recordFactoryAutomationRunPrompt: recordFactoryAutomationRunPromptMock,
}));

vi.mock("@agent-native/core/event-bus", () => ({
  subscribe: vi.fn(),
  registerEvent: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@agent-native/core/notifications", () => ({
  notify: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  resolveOrgIdForEmail: vi.fn(),
}));

vi.mock("@agent-native/core/resources", () => ({
  organizationResourceOwner: (orgId: string) => `__organization__:${orgId}`,
  resourceDeleteByPath: resourceDeleteByPathMock,
  resourceGetByPath: resourceGetByPathMock,
  resourceList: resourceListMock,
  resourceListContentByOwnersAndPrefixes: resourceListContentMock,
  resourcePut: resourcePutMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
  WORKSPACE_OWNER: "workspace",
}));

vi.mock("@agent-native/core/server", () => ({
  defineNitroPlugin: () => undefined,
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));

vi.mock("@agent-native/core/triggers", () => ({
  deleteAutomationRuns: deleteAutomationRunsMock,
  listAutomationDefinitions: listAutomationDefinitionsMock,
}));

vi.mock("../db/index.js", () => ({
  getDb: getDbMock,
}));

vi.mock("../lib/factory-automation-repair.js", () => ({
  repairFactoryAutomationsFromConfig: vi.fn(),
}));

import {
  ensureFactoryAutomations,
  factoryAutomationTemplatePrompt,
  recordFinishedAutomationPrompt,
  removeFactoryAutomationResources,
  removeFactoryAutomationRunHistory,
  snapshotFactoryAutomations,
} from "./factory-scheduler-job.js";

beforeEach(() => {
  vi.clearAllMocks();
  listAutomationDefinitionsMock.mockResolvedValue([]);
  resourceListMock.mockResolvedValue([]);
  resourceListContentMock.mockResolvedValue([]);
  resourceDeleteByPathMock.mockResolvedValue(true);
  deleteAutomationRunsMock.mockResolvedValue(undefined);
  insertAutomationVersionValuesMock.mockResolvedValue(undefined);
  getDbMock.mockReturnValue({
    insert: () => ({ values: insertAutomationVersionValuesMock }),
  });
});

describe("ensureFactoryAutomations", () => {
  it("does not create missing seed jobs", async () => {
    resourceGetByPathMock.mockResolvedValue(null);

    await ensureFactoryAutomations(
      "owner@example.com",
      "org-1",
      "support-triage",
    );

    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("repairs a suffixed PR babysit copy back to GitHub", async () => {
    const copyPath = "jobs/factories/support-triage/factory-pr-babysit-2.md";
    const copyContent = `---
schedule: "*/5 * * * *"
enabled: false
orgId: org-1
appId: factory
template: pr-babysit
repository: acme/widgets
source: slack
---
Babysit pull requests.
`;
    resourceListContentMock.mockResolvedValue([
      {
        id: "copy",
        owner: "__organization__:org-1",
        path: copyPath,
        content: copyContent,
      },
    ]);
    resourceGetByPathMock.mockImplementation((_owner: string, path: string) => {
      if (path !== copyPath) return null;
      return {
        id: "copy",
        owner: "__organization__:org-1",
        path: copyPath,
        content: copyContent,
        updatedAt: 1,
      };
    });
    resourcePutIfCurrentMock.mockResolvedValue({ id: "copy" });

    await ensureFactoryAutomations(
      "owner@example.com",
      "org-1",
      "support-triage",
    );

    const saved = resourcePutIfCurrentMock.mock.calls.find(
      (call) => call[0]?.path === copyPath,
    )?.[0]?.content as string | undefined;
    expect(saved).toMatch(/^source: github$/m);
    expect(saved).toMatch(/^template: pr-babysit$/m);
  });

  it("preserves automation display name, channel, and author filter during repair", async () => {
    const path = "jobs/factories/product-an-feedback/factory-slack-feedback.md";
    const content = `---
schedule: "* * * * *"
enabled: true
orgId: org-1
appId: factory
template: slack-feedback
source: slack
displayName: Product feedback
slackChannelId: C0ATH3CCZT4
slackChannelName: product-feedback
authorMode: exclude
authorIds: U096KN3EL2Y
model: claude-sonnet-4-20250514
maxIterations: 20
maxRunInputTokens: 200000
---
Classify Slack feedback.
`;
    resourceListContentMock.mockResolvedValue([
      {
        id: "slack-feedback",
        owner: "__organization__:org-1",
        path,
        content,
      },
    ]);
    resourceGetByPathMock.mockImplementation((_owner: string, p: string) => {
      if (p !== path) return null;
      return {
        id: "slack-feedback",
        owner: "__organization__:org-1",
        path,
        content,
        updatedAt: 1,
      };
    });
    resourcePutIfCurrentMock.mockResolvedValue({ id: "slack-feedback" });

    await ensureFactoryAutomations(
      "owner@example.com",
      "org-1",
      "product-an-feedback",
    );

    const saved = resourcePutIfCurrentMock.mock.calls.find(
      (call) => call[0]?.path === path,
    )?.[0]?.content as string | undefined;
    expect(saved).toBeDefined();
    expect(saved).toContain("displayName: Product feedback");
    expect(saved).toContain("slackChannelId: C0ATH3CCZT4");
    expect(saved).toContain("authorIds: U096KN3EL2Y");
    expect(saved).toContain("Classify Slack feedback.");
    expect(recordFactoryGovernanceAuditMock).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.objectContaining({
        action: "repair-factory-automation-metadata",
        kind: "governance",
        factoryId: "product-an-feedback",
      }),
    );
  });

  it("does not rewrite the automation prompt body during metadata repair", async () => {
    const path = "jobs/factories/product-an-feedback/factory-slack-feedback.md";
    const customPrompt = "Only triage messages from paying customers.";
    const content = `---
schedule: "* * * * *"
enabled: true
orgId: org-1
appId: factory
template: slack-feedback
source: slack
displayName: Product feedback
slackChannelId: C0ATH3CCZT4
model: claude-sonnet-4-20250514
maxIterations: 20
maxRunInputTokens: 200000
---
${customPrompt}
`;
    resourceListContentMock.mockResolvedValue([
      {
        id: "slack-feedback",
        owner: "__organization__:org-1",
        path,
        content,
      },
    ]);
    resourceGetByPathMock.mockImplementation((_owner: string, p: string) => {
      if (p !== path) return null;
      return {
        id: "slack-feedback",
        owner: "__organization__:org-1",
        path,
        content,
        updatedAt: 1,
      };
    });
    resourcePutIfCurrentMock.mockResolvedValue({ id: "slack-feedback" });

    await ensureFactoryAutomations(
      "owner@example.com",
      "org-1",
      "product-an-feedback",
    );

    const saved = resourcePutIfCurrentMock.mock.calls.find(
      (call) => call[0]?.path === path,
    )?.[0]?.content as string | undefined;
    expect(saved).toBeDefined();
    expect(saved).toContain(customPrompt);
    expect(saved).not.toContain("# Factory Slack feedback triage");
  });

  it("recomposes duplicate alignment blocks while preserving identity and user prompt", async () => {
    const path = "jobs/factories/product-an-feedback/factory-slack-feedback.md";
    const { managedReviewSkillAlignmentMarkers } =
      await import("../triage/review-skill-alignment.js");
    const { start, end } = managedReviewSkillAlignmentMarkers();
    const userPrompt = "Only triage paying customers.";
    const content = `---
schedule: "* * * * *"
enabled: true
orgId: org-1
appId: factory
template: slack-feedback
source: slack
displayName: Product feedback
slackChannelId: C0ATH3CCZT4
authorIds: U096KN3EL2Y
model: claude-sonnet-4-20250514
maxIterations: 20
maxRunInputTokens: 200000
---
${start}
stale one
${end}

${start}
stale two
${end}

${userPrompt}
`;
    resourceListContentMock.mockResolvedValue([
      {
        id: "slack-feedback",
        owner: "__organization__:org-1",
        path,
        content,
      },
    ]);
    resourceGetByPathMock.mockImplementation((_owner: string, p: string) => {
      if (p !== path) return null;
      return {
        id: "slack-feedback",
        owner: "__organization__:org-1",
        path,
        content,
        updatedAt: 1,
      };
    });
    resourcePutIfCurrentMock.mockResolvedValue({ id: "slack-feedback" });

    await ensureFactoryAutomations(
      "owner@example.com",
      "org-1",
      "product-an-feedback",
    );

    const saved = resourcePutIfCurrentMock.mock.calls.find(
      (call) => call[0]?.path === path,
    )?.[0]?.content as string | undefined;
    expect(saved).toBeDefined();
    expect(saved).toContain("displayName: Product feedback");
    expect(saved).toContain("slackChannelId: C0ATH3CCZT4");
    expect(saved).toContain("authorIds: U096KN3EL2Y");
    expect(saved).toContain(userPrompt);
    expect(saved!.split(start).length - 1).toBe(1);
    expect(insertAutomationVersionValuesMock).toHaveBeenCalled();
    expect(recordFactoryGovernanceAuditMock).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.objectContaining({
        action: "repair-factory-automation-body",
      }),
    );
  });

  it("keeps the Slack template prompt lean and names the reaction argument", () => {
    const prompt = factoryAutomationTemplatePrompt("slack-feedback", "slack");
    expect(prompt).toContain("MUST pass reaction eyes");
    expect(prompt).toContain("get-slack-feedback-context");
    expect(prompt).toContain("productUxImplications false");
    expect(prompt).toContain("visual/UI defects");
    expect(prompt).toContain("already has eyes 👀");
    expect(prompt).toContain("alreadyClaimed true");
    expect(prompt).toContain("clearBug may be omitted");
    expect(prompt).toContain("omit reaction");
    expect(prompt).not.toContain("robot_face");
    expect(prompt).not.toContain("limit 20");
    expect(prompt).not.toContain("that action adds 👀");
  });

  it("keeps the PR babysit prompt as a thin action playbook", () => {
    const prompt = factoryAutomationTemplatePrompt("pr-babysit", "github");
    expect(prompt).toContain("propose-pr-babysit-status");
    expect(prompt).toContain("babysit-factory-pull-request");
    expect(prompt).toContain("already_asked");
    expect(prompt).toContain("stuck");
    expect(prompt).toContain("mergeability alone do not");
    expect(prompt).not.toContain("It owns GitHub");
    expect(prompt).not.toContain("A changed commit, new unresolved");
    expect(prompt).not.toContain("2 minutes");
    expect(prompt).not.toContain("Do not ask the bot to poll");
  });

  it("binds the scheduled PR governance exception to Shomix's immutable ID", () => {
    const prompt = factoryAutomationTemplatePrompt("pr-governance", "github");

    expect(prompt).toContain("shomix, GitHub user ID 100691266");
    expect(prompt).toContain("do not rely on the mutable login alone");
  });
});

describe("removeFactoryAutomationResources", () => {
  it("deletes prefix jobs and discovered factory jobs without run history", async () => {
    const prefixPath =
      "jobs/factories/support-triage/legacy-without-trigger.md";
    const discoveredPath =
      "jobs/factories/support-triage/factory-slack-custom.md";
    resourceListMock
      .mockResolvedValueOnce([{ path: prefixPath }])
      .mockResolvedValueOnce([]);
    resourceListContentMock
      .mockResolvedValueOnce([
        {
          id: "custom",
          owner: "__organization__:org-1",
          path: discoveredPath,
          content: "---\nenabled: true\n---\nObserve Slack.\n",
        },
      ])
      .mockResolvedValueOnce([]);

    await removeFactoryAutomationResources(
      "org-1",
      "support-triage",
      "owner@example.com",
    );

    expect(resourceListMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "jobs/factories/support-triage/",
    );
    expect(resourceDeleteByPathMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      prefixPath,
    );
    expect(resourceDeleteByPathMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      discoveredPath,
    );
    expect(deleteAutomationRunsMock).not.toHaveBeenCalled();
  });

  it("deletes run history for the same Factory job paths after SQL commit", async () => {
    const prefixPath =
      "jobs/factories/support-triage/legacy-without-trigger.md";
    const discoveredPath =
      "jobs/factories/support-triage/factory-slack-custom.md";
    resourceListMock.mockResolvedValue([]);
    listAutomationDefinitionsMock.mockResolvedValue([]);

    await removeFactoryAutomationRunHistory(
      "org-1",
      "support-triage",
      "owner@example.com",
      [prefixPath, discoveredPath],
    );

    expect(deleteAutomationRunsMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "factories/support-triage/legacy-without-trigger",
    );
    expect(deleteAutomationRunsMock).toHaveBeenCalledWith(
      "__organization__:org-1",
      "factories/support-triage/factory-slack-custom",
    );
  });

  it("fails loud when a Factory job is still present after delete", async () => {
    const leftover = "jobs/factories/support-triage/factory-slack-custom.md";
    resourceListMock.mockResolvedValue([{ path: leftover }]);
    resourceDeleteByPathMock.mockResolvedValue(false);

    await expect(
      removeFactoryAutomationResources(
        "org-1",
        "support-triage",
        "owner@example.com",
      ),
    ).rejects.toThrow(`could not delete: ${leftover}`);
  });
});

describe("snapshotFactoryAutomations", () => {
  it("snapshots every file under the Factory job prefix", async () => {
    const path = "jobs/factories/support-triage/legacy-without-trigger.md";
    resourceListMock.mockResolvedValue([{ path }]);
    resourceGetByPathMock.mockResolvedValue({
      path,
      content: "---\nenabled: true\n---\nObserve.\n",
    });

    await expect(
      snapshotFactoryAutomations(
        "owner@example.com",
        "org-1",
        "support-triage",
      ),
    ).resolves.toEqual([
      {
        path,
        content: "---\nenabled: true\n---\nObserve.\n",
      },
    ]);
  });

  it("fails when a listed automation cannot be read", async () => {
    const path = "jobs/factories/support-triage/github.md";
    resourceListMock.mockResolvedValue([{ path }]);
    resourceGetByPathMock.mockResolvedValue(null);

    await expect(
      snapshotFactoryAutomations(
        "owner@example.com",
        "org-1",
        "support-triage",
      ),
    ).rejects.toThrow("unreadable and cannot be snapshotted");
  });
});

describe("recordFinishedAutomationPrompt", () => {
  const path = "jobs/factories/support-triage/factory-slack-feedback.md";

  it("audits the live resource's prompt version under the agent run id", async () => {
    resourceGetByPathMock.mockResolvedValue({
      path,
      content: "---\npromptVersion: 3\n---\nCurrent prompt.\n",
    });

    await recordFinishedAutomationPrompt({
      automationRunId: "history-row-1",
      owner: "workspace",
      automation: "factory-slack-feedback",
      path,
      orgId: "org-1",
      runId: "agent-run-1",
      threadId: null,
      status: "success",
      error: null,
    });

    expect(resourceGetByPathMock).toHaveBeenCalledWith("workspace", path);
    expect(recordFactoryAutomationRunPromptMock).toHaveBeenCalledTimes(1);
    const call = recordFactoryAutomationRunPromptMock.mock.calls[0][0];
    expect(call.promptVersion).toBe(3);
    // Must be the agent run id (list-factory-audit's join key), not the core
    // history-row id — those are two different id spaces.
    expect(call.automationRunId).toBe("agent-run-1");
    expect(call.path).toBe(path);
  });

  it("does not record when the run has no agent run id to join on", async () => {
    await recordFinishedAutomationPrompt({
      automationRunId: "history-row-3",
      owner: "workspace",
      automation: "factory-slack-feedback",
      path,
      orgId: "org-1",
      runId: null,
      threadId: null,
      status: "success",
      error: null,
    });

    expect(resourceGetByPathMock).not.toHaveBeenCalled();
    expect(recordFactoryAutomationRunPromptMock).not.toHaveBeenCalled();
  });

  it("does not record when the automation resource is gone", async () => {
    resourceGetByPathMock.mockResolvedValue(null);

    await recordFinishedAutomationPrompt({
      automationRunId: "history-row-2",
      owner: "workspace",
      automation: "factory-slack-feedback",
      path,
      orgId: "org-1",
      runId: "agent-run-2",
      threadId: null,
      status: "success",
      error: null,
    });

    expect(recordFactoryAutomationRunPromptMock).not.toHaveBeenCalled();
  });
});
