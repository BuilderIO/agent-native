import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const insertResourceVersionMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

vi.mock("@agent-native/core/history", () => ({
  insertResourceVersion: insertResourceVersionMock,
}));

vi.mock("@agent-native/core/resources", () => ({
  resourceGetByPath: resourceGetByPathMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
}));

const currentContent = `---
factoryId: myfact
displayName: Slack feedback
promptVersion: 2
configSavedAt: 2026-09-15T12:00:00.000Z
source: slack
template: slack-feedback
slackChannelId: C123
---

Current prompt.
`;

const snapshot = {
  userPrompt: "Restored prompt.",
  displayName: "Slack feedback",
  config: {
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
  },
  promptVersion: 1,
  alignmentRevision: 1,
  configSavedAt: "2026-09-01T10:00:00.000Z",
  factoryId: "myfact",
};

beforeEach(() => {
  vi.clearAllMocks();
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
  const config = snapshot.config;

  it("keeps the current version when the saved identity is unchanged", async () => {
    const { resolvePromptVersionForSnapshot } =
      await import("./factory-automation-history.js");
    const previous = {
      ...snapshot,
      userPrompt: "Current prompt.",
      promptVersion: 3,
    };
    expect(
      resolvePromptVersionForSnapshot(
        {
          userPrompt: previous.userPrompt,
          displayName: previous.displayName,
          config,
        },
        previous,
      ),
    ).toBe(3);
  });

  it("advances past the current version even when restored content matches an older snapshot exactly", async () => {
    const { resolvePromptVersionForSnapshot } =
      await import("./factory-automation-history.js");
    const previous = {
      ...snapshot,
      userPrompt: "Current prompt.",
      promptVersion: 3,
    };
    expect(
      resolvePromptVersionForSnapshot(
        {
          userPrompt: snapshot.userPrompt,
          displayName: snapshot.displayName,
          config,
        },
        previous,
      ),
    ).toBe(4);
  });

  it("assigns the current version plus one for genuinely new content", async () => {
    const { resolvePromptVersionForSnapshot } =
      await import("./factory-automation-history.js");
    const previous = {
      ...snapshot,
      userPrompt: "Current prompt.",
      promptVersion: 3,
    };
    expect(
      resolvePromptVersionForSnapshot(
        {
          userPrompt: "Brand new prompt.",
          displayName: snapshot.displayName,
          config,
        },
        previous,
      ),
    ).toBe(4);
  });
});

describe("restoreFactoryAutomationSnapshot", () => {
  it("uses the authoritative resource row for conditional writes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T13:00:00.000Z"));
    try {
      const { restoreFactoryAutomationSnapshot } =
        await import("./factory-automation-history.js");
      const result = await restoreFactoryAutomationSnapshot({
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
        automationName: "factory-slack-feedback",
        factoryId: "myfact",
        snapshot,
        userEmail: "owner@example.com",
        orgId: "org-1",
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
      // currentContent is promptVersion 2; restoring different content always
      // advances past it rather than reusing the restored snapshot's own v1.
      expect(result.promptVersion).toBe(3);
      expect(result.configSavedAt).toBe("2026-09-15T13:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});
