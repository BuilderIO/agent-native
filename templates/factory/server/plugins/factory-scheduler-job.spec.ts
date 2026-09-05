import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteAutomationRunsMock = vi.hoisted(() => vi.fn());
const listAutomationDefinitionsMock = vi.hoisted(() => vi.fn());
const resourceDeleteByPathMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourceListMock = vi.hoisted(() => vi.fn());
const resourceListContentMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());

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
  getDb: vi.fn(),
}));

vi.mock("../lib/factory-automation-repair.js", () => ({
  repairFactoryAutomationsFromConfig: vi.fn(),
}));

import {
  ensureFactoryAutomations,
  factoryAutomationTemplatePrompt,
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

  it("keeps the Slack template prompt lean and names the reaction argument", () => {
    const prompt = factoryAutomationTemplatePrompt("slack-feedback", "slack");
    expect(prompt).toContain("reaction robot_face 🤖");
    expect(prompt).toContain("get-slack-feedback-context");
    expect(prompt).toContain("productUxImplications false");
    expect(prompt).toContain("visual/UI defects");
    expect(prompt).not.toContain("limit 20");
    expect(prompt).not.toContain("👀");
  });

  it("keeps the PR babysit prompt as a thin action playbook", () => {
    const prompt = factoryAutomationTemplatePrompt("pr-babysit", "github");
    expect(prompt).toContain("babysit-factory-pull-request");
    expect(prompt).toContain("It owns GitHub");
    expect(prompt).not.toContain("A changed commit, new unresolved");
    expect(prompt).not.toContain("2 minutes");
    expect(prompt).not.toContain("Do not ask the bot to poll");
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
