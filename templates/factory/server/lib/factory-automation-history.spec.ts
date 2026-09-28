import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const insertValuesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({ getDb: getDbMock }));

vi.mock("@agent-native/core/resources", () => ({
  resourceGetByPath: resourceGetByPathMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
}));

const sampleConfig = {
  source: "slack" as const,
  template: "slack-feedback" as const,
  slackWorkspace: "primary" as const,
  slackChannelId: "C123",
  slackChannelName: null,
  repository: null,
  sentryOrgSlug: null,
  sentryProjectSlug: null,
  sentryEnvironment: null,
  authorMode: "exclude" as const,
  authorIds: [],
  scheduleMode: "interval" as const,
  intervalMinutes: 5 as const,
  dailyHour: 9,
  dailyMinute: 0,
  timezone: "UTC",
  inboxLimit: 25,
  workLimit: 5,
};

const currentContent = `---
factoryId: myfact
displayName: Slack feedback
promptVersion: 2
configSavedAt: 2026-09-15T12:00:00.000Z
source: slack
template: slack-feedback
slackWorkspace: primary
slackChannelId: C123
authorMode: exclude
scheduleMode: interval
intervalMinutes: 5
timezone: UTC
inboxLimit: 25
workLimit: 5
---

Current prompt.
`;

const historicalContent = `---
factoryId: myfact
displayName: Slack feedback
promptVersion: 1
configSavedAt: 2026-09-01T10:00:00.000Z
source: slack
template: slack-feedback
slackWorkspace: primary
slackChannelId: C123
authorMode: exclude
scheduleMode: interval
intervalMinutes: 5
timezone: UTC
inboxLimit: 25
workLimit: 5
---

Restored prompt.
`;

beforeEach(() => {
  vi.clearAllMocks();
  insertValuesMock.mockResolvedValue(undefined);
  getDbMock.mockReturnValue({
    insert: () => ({ values: insertValuesMock }),
  });
  resourceGetByPathMock.mockResolvedValue({
    id: "resource-1",
    owner: "__organization__:org-1",
    path: "jobs/factories/myfact/factory-slack-feedback.md",
    content: currentContent,
    mimeType: "text/markdown",
    updatedAt: 42,
  });
  resourcePutIfCurrentMock.mockResolvedValue({
    id: "resource-1",
    owner: "__organization__:org-1",
    path: "jobs/factories/myfact/factory-slack-feedback.md",
    content: "updated",
    mimeType: "text/markdown",
    updatedAt: 43,
  });
});

describe("resolvePromptVersionForSnapshot", () => {
  it("keeps the current version when the saved identity is unchanged", async () => {
    const { resolvePromptVersionForSnapshot } =
      await import("./factory-automation-history.js");
    const previous = {
      userPrompt: "Current prompt.",
      displayName: "Slack feedback",
      config: sampleConfig,
      promptVersion: 3,
      alignmentRevision: 1,
      configSavedAt: "2026-09-15T12:00:00.000Z",
      factoryId: "myfact",
    };
    expect(
      resolvePromptVersionForSnapshot(
        {
          userPrompt: previous.userPrompt,
          displayName: previous.displayName,
          config: sampleConfig,
        },
        previous,
      ),
    ).toBe(3);
  });

  it("advances past the current version even when restored content matches an older snapshot exactly", async () => {
    const { resolvePromptVersionForSnapshot } =
      await import("./factory-automation-history.js");
    const previous = {
      userPrompt: "Current prompt.",
      displayName: "Slack feedback",
      config: sampleConfig,
      promptVersion: 3,
      alignmentRevision: 1,
      configSavedAt: "2026-09-15T12:00:00.000Z",
      factoryId: "myfact",
    };
    expect(
      resolvePromptVersionForSnapshot(
        {
          userPrompt: "Restored prompt.",
          displayName: "Slack feedback",
          config: sampleConfig,
        },
        previous,
      ),
    ).toBe(4);
  });

  it("assigns the current version plus one for genuinely new content", async () => {
    const { resolvePromptVersionForSnapshot } =
      await import("./factory-automation-history.js");
    const previous = {
      userPrompt: "Current prompt.",
      displayName: "Slack feedback",
      config: sampleConfig,
      promptVersion: 3,
      alignmentRevision: 1,
      configSavedAt: "2026-09-15T12:00:00.000Z",
      factoryId: "myfact",
    };
    expect(
      resolvePromptVersionForSnapshot(
        {
          userPrompt: "Brand new prompt.",
          displayName: "Slack feedback",
          config: sampleConfig,
        },
        previous,
      ),
    ).toBe(4);
  });
});

describe("restoreFactoryAutomationVersion", () => {
  it("uses the authoritative resource row for conditional writes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T13:00:00.000Z"));
    try {
      const { restoreFactoryAutomationVersion } =
        await import("./factory-automation-history.js");
      const result = await restoreFactoryAutomationVersion({
        resource: {
          id: "resource-1",
          owner: "__organization__:org-1",
          path: "jobs/factories/myfact/factory-slack-feedback.md",
          content: currentContent,
          mimeType: "text/markdown",
          size: currentContent.length,
          createdAt: 0,
          updatedAt: 0,
          createdBy: "system",
          visibility: "workspace",
          threadId: null,
          runId: null,
          expiresAt: null,
          metadata: null,
        },
        automationId: "resource-1",
        automationName: "factory-slack-feedback",
        factoryId: "myfact",
        historicalContent,
        userEmail: "owner@example.com",
        orgId: "org-1",
        summary: "Before restoring version 1",
      });

      expect(resourceGetByPathMock).toHaveBeenCalledWith(
        "__organization__:org-1",
        "jobs/factories/myfact/factory-slack-feedback.md",
      );
      expect(resourcePutIfCurrentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedUpdatedAt: 42,
          expectedContent: currentContent,
        }),
      );
      expect(result.version).toBe(3);
      expect(result.configSavedAt).toBe("2026-09-15T13:00:00.000Z");
      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rawContent: currentContent,
          version: 2,
          source: "restore",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
