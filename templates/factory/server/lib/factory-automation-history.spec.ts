import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const insertValuesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getDbMock = vi.hoisted(() => vi.fn());
const selectMaxMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({ getDb: getDbMock }));

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string): never => {
    throw new Error(message);
  },
}));

vi.mock("@agent-native/core/db", () => ({
  isUniqueViolation: (error: { code?: string }) => error?.code === "23505",
}));

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
  selectMaxMock.mockResolvedValue([{ latest: null }]);
  getDbMock.mockReturnValue({
    insert: () => ({ values: insertValuesMock }),
    select: () => ({ from: () => ({ where: selectMaxMock }) }),
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

const slackSnapshot = {
  userPrompt: "Current prompt.",
  displayName: "Slack feedback",
  config: sampleConfig,
  promptVersion: 3,
  alignmentRevision: 1,
  configSavedAt: "2026-09-15T12:00:00.000Z",
  factoryId: "myfact",
};

describe("resolvePromptVersionAllocation", () => {
  const allocate = async (
    next: { userPrompt: string },
    previous = slackSnapshot,
  ) => {
    const { resolvePromptVersionAllocation } =
      await import("./factory-automation-history.js");
    return resolvePromptVersionAllocation({
      automationId: "resource-1",
      orgId: "org-1",
      next: {
        userPrompt: next.userPrompt,
        displayName: previous.displayName,
        config: sampleConfig,
      },
      previous,
    });
  };

  it("keeps the current version and stores nothing when the identity is unchanged", async () => {
    selectMaxMock.mockResolvedValue([{ latest: 2 }]);

    await expect(allocate({ userPrompt: "Current prompt." })).resolves.toEqual({
      promptVersion: 3,
      predecessorVersion: null,
    });
  });

  it("stores the previous content under its own version and advances past it", async () => {
    selectMaxMock.mockResolvedValue([{ latest: 2 }]);

    await expect(
      allocate({ userPrompt: "Brand new prompt." }),
    ).resolves.toEqual({ promptVersion: 4, predecessorVersion: 3 });
  });

  it("starts at version 0 for an automation with no history", async () => {
    selectMaxMock.mockResolvedValue([{ latest: null }]);

    await expect(
      allocate(
        { userPrompt: "Brand new prompt." },
        { ...slackSnapshot, promptVersion: 0 },
      ),
    ).resolves.toEqual({ promptVersion: 1, predecessorVersion: 0 });
  });

  it("moves past stored history when the file lost its promptVersion", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    selectMaxMock.mockResolvedValue([{ latest: 1 }]);

    await expect(
      allocate(
        { userPrompt: "Brand new prompt." },
        { ...slackSnapshot, promptVersion: 0 },
      ),
    ).resolves.toEqual({ promptVersion: 3, predecessorVersion: 2 });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("reports promptVersion 0 but versions up to 1"),
    );
    warn.mockRestore();
  });

  it("follows a file whose number is ahead of its history", async () => {
    selectMaxMock.mockResolvedValue([{ latest: 1 }]);

    await expect(
      allocate({ userPrompt: "Brand new prompt." }),
    ).resolves.toEqual({ promptVersion: 4, predecessorVersion: 3 });
  });
});

describe("insertFactoryAutomationVersionRow", () => {
  const insert = async (version?: number) => {
    const { insertFactoryAutomationVersionRow } =
      await import("./factory-automation-history.js");
    return insertFactoryAutomationVersionRow({
      automationId: "resource-1",
      factoryId: "myfact",
      orgId: "org-1",
      userEmail: "alice@example.com",
      automationName: "factories/myfact/factory-slack-feedback",
      content: currentContent,
      summary: "Before deduped injected prompt blocks",
      source: "repair",
      version,
    });
  };

  it("allocates a free version when the caller does not supply one", async () => {
    selectMaxMock.mockResolvedValue([{ latest: 2 }]);

    await expect(insert()).resolves.toMatchObject({ version: 3 });
  });

  it("stores under the version it was given", async () => {
    await expect(insert(7)).resolves.toMatchObject({ version: 7 });
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ version: 7 }),
    );
  });

  it("raises a lost version race as a conflict, not a server error", async () => {
    insertValuesMock.mockRejectedValue(
      Object.assign(new Error("Failed query"), { cause: { code: "23505" } }),
    );

    await expect(insert(2)).rejects.toThrow("saved at the same time");
  });

  it("does not disguise other database failures as a conflict", async () => {
    insertValuesMock.mockRejectedValue(new Error("connection reset"));

    await expect(insert(2)).rejects.toThrow("connection reset");
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

  describe("trigger type", () => {
    const restoreWith = async (live: string, historical: string) => {
      resourceGetByPathMock.mockResolvedValue({
        id: "resource-1",
        owner: "__organization__:org-1",
        path: "jobs/factories/myfact/factory-slack-feedback.md",
        content: live,
        mimeType: "text/markdown",
        updatedAt: 42,
      });
      const { restoreFactoryAutomationVersion } =
        await import("./factory-automation-history.js");
      await restoreFactoryAutomationVersion({
        resource: {
          id: "resource-1",
          owner: "__organization__:org-1",
          path: "jobs/factories/myfact/factory-slack-feedback.md",
          content: live,
          mimeType: "text/markdown",
          size: live.length,
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
        historicalContent: historical,
        userEmail: "owner@example.com",
        orgId: "org-1",
        summary: "Before restoring version 1",
      });
      return resourcePutIfCurrentMock.mock.calls[0]?.[0].content as string;
    };
    const tagged = (content: string, type: string) =>
      content.replace(
        "factoryId: myfact",
        `factoryId: myfact\ntriggerType: ${type}`,
      );

    it("stamps triggerType: schedule when neither file has one", async () => {
      const written = await restoreWith(currentContent, historicalContent);

      expect(written).toContain("triggerType: schedule");
    });

    it("keeps the live file's trigger type when the restored version predates it", async () => {
      const written = await restoreWith(
        tagged(currentContent, "webhook"),
        historicalContent,
      );

      expect(written.match(/^triggerType:.*$/gm)).toEqual([
        "triggerType: webhook",
      ]);
    });

    it("leaves a trigger type the restored version already has", async () => {
      const written = await restoreWith(
        tagged(currentContent, "webhook"),
        tagged(historicalContent, "event"),
      );

      expect(written.match(/^triggerType:.*$/gm)).toEqual([
        "triggerType: event",
      ]);
    });
  });
});
