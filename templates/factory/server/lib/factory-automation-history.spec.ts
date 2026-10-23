import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const insertValuesMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getDbMock = vi.hoisted(() => vi.fn());
const selectMaxMock = vi.hoisted(() => vi.fn());
const deleteReturningMock = vi.hoisted(() => vi.fn());

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
  template: "blank" as const,
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
template: blank
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
template: blank
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
  deleteReturningMock.mockResolvedValue([{ id: "deleted-version" }]);
  getDbMock.mockReturnValue({
    insert: () => ({ values: insertValuesMock }),
    select: () => ({ from: () => ({ where: selectMaxMock }) }),
    delete: () => ({ where: () => ({ returning: deleteReturningMock }) }),
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

it("retains saved multiline metadata representation", async () => {
  const { buildJobResourceContent, parseJobResource } =
    await import("@agent-native/core/jobs/frontmatter");
  const lastError =
    "Saved\u2028model: retained\u2029enabled: false\u0085detail";
  const content = buildJobResourceContent(
    { schedule: "*/5 * * * *", enabled: true, lastError },
    "Prompt body.\nSecond paragraph.",
  );
  const parsed = parseJobResource(content);
  expect(parsed.meta.lastError).toBe(lastError);
  expect(parsed.meta.enabled).toBe(true);
  expect(parsed.meta.model).toBeUndefined();
  expect(
    content.split(/\r?\n/).filter((line) => line.startsWith("lastError:")),
  ).toHaveLength(1);
  expect(parsed.body).toBe("Prompt body.\nSecond paragraph.");
});

it("previews a headerless historical prompt without writes", async () => {
  const { snapshotFromAutomationResource } =
    await import("./factory-automation-history.js");
  const snapshot = snapshotFromAutomationResource(
    "Stored prompt.\nSecond paragraph.",
    "factory-slack-feedback",
    "myfact",
  );
  expect(snapshot).toMatchObject({
    userPrompt: "Stored prompt.\nSecond paragraph.",
    displayName: null,
    promptVersion: 0,
    config: { source: "slack" },
  });
  expect(insertValuesMock).not.toHaveBeenCalled();
  expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
});

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
  const resource = {
    id: "resource-1",
    owner: "__organization__:org-1",
    path: "jobs/factories/myfact/factory-slack-feedback.md",
    content: currentContent,
    mimeType: "text/markdown",
    size: Buffer.byteLength(currentContent),
    createdAt: 0,
    updatedAt: 0,
    createdBy: "system" as const,
    visibility: "workspace" as const,
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  };
  const restoreInput = {
    resource,
    automationId: "resource-1",
    automationName: "factory-slack-feedback",
    factoryId: "myfact",
    historicalContent,
    userEmail: "owner@example.com",
    orgId: "org-1",
    summary: "Before restoring version 1",
  };

  it("preserves saved metadata and body bytes during restore", async () => {
    const { buildJobResourceContent, parseJobResource } =
      await import("@agent-native/core/jobs/frontmatter");
    const lastError =
      'Saved "detail"\nSecond line.\u2028model: retained\u2029more\u0085context';
    const condition =
      "A condition\nwith context\u2028and more\u2029detail\u0085text";
    const saved = buildJobResourceContent(
      { schedule: "*/5 * * * *", enabled: false, lastError, condition },
      "Body",
    );
    const lastErrorLine = saved
      .split("\n")
      .find((line) => line.startsWith("lastError:"))!;
    const conditionLine = saved
      .split("\n")
      .find((line) => line.startsWith("condition:"))!;
    const live = currentContent.replace(
      "factoryId: myfact",
      `factoryId: myfact\nenabled: false\n${lastErrorLine}`,
    );
    const historical = historicalContent.replace(
      "factoryId: myfact",
      `factoryId: myfact\ncustomFactory: retained\n${conditionLine}`,
    );
    resourceGetByPathMock.mockResolvedValue({
      ...resource,
      content: live,
      updatedAt: 42,
    });
    resourcePutIfCurrentMock.mockImplementation(async (candidate) => ({
      ...resource,
      content: candidate.content,
      size: Buffer.byteLength(candidate.content),
      updatedAt: 43,
    }));
    const { restoreFactoryAutomationVersion } =
      await import("./factory-automation-history.js");
    const result = await restoreFactoryAutomationVersion(
      { ...restoreInput, historicalContent: historical },
      {
        caller: "tool",
        networkProtocol: "mcp",
        userEmail: "owner@example.com",
      },
    );
    expect(parseJobResource(result.resource.content).meta).toMatchObject({
      lastError,
      condition,
      mcpManaged: true,
      enabled: false,
    });
    expect(result.resource.content).toContain(lastErrorLine);
    expect(result.resource.content).toContain(conditionLine);
    expect(result.resource.content).toContain("customFactory: retained");
    expect(result.resource.content.endsWith("\n\nRestored prompt.\n")).toBe(
      true,
    );
    expect(resourcePutIfCurrentMock.mock.calls[0][0].expectedContent).toBe(
      live,
    );
    expect(insertValuesMock.mock.calls[0][0].rawContent).toBe(live);
  });

  it.each([
    {
      currentSettings: "mcpManaged: true\n mcpManaged : false",
      historicalSettings: "",
      lineEnding: "\n",
      caller: "frontend" as const,
    },
    {
      currentSettings: " mcpManaged : false\nmcpManaged: true",
      historicalSettings: "mcpManaged: false",
      lineEnding: "\r\n",
      caller: "tool" as const,
    },
    {
      currentSettings: "",
      historicalSettings: "mcpManaged: true\n mcpManaged : false",
      lineEnding: "\n",
      caller: "frontend" as const,
    },
    {
      currentSettings: "",
      historicalSettings: " mcpManaged : false\nmcpManaged: true",
      lineEnding: "\r\n",
      caller: "tool" as const,
    },
    {
      currentSettings: "",
      historicalSettings: "mcpManaged: false\n mcpManaged : false",
      lineEnding: "\r\n",
      caller: "tool" as const,
      networkProtocol: "mcp" as const,
    },
    {
      currentSettings: "mcpManaged: true\n mcpManaged : false",
      historicalSettings: "mcpManaged: false\n mcpManaged : true",
      lineEnding: "\n",
      caller: "tool" as const,
      networkProtocol: "a2a" as const,
    },
  ])(
    "restores single reserved settings for $caller/$networkProtocol with line ending $lineEnding",
    async ({ currentSettings, historicalSettings, lineEnding, ...context }) => {
      const live = currentContent
        .replace(
          "factoryId: myfact",
          `factoryId: myfact\n${currentSettings}\nlastRun: older\n lastRun : latest\nenabled: true\n enabled : false`,
        )
        .replace(/\n/g, lineEnding);
      const historical = historicalContent
        .replace(
          "factoryId: myfact",
          `factoryId: myfact\n${historicalSettings}\ncustomFactory: retained\nlastRun: historical\nlastRun: obsolete\nenabled: true\nenabled: true`,
        )
        .replace(/\n/g, lineEnding);
      resourceGetByPathMock.mockResolvedValue({
        ...resource,
        content: live,
        updatedAt: 42,
      });
      resourcePutIfCurrentMock.mockImplementation(async (candidate) => ({
        ...resource,
        content: candidate.content,
        size: Buffer.byteLength(candidate.content),
        updatedAt: 43,
      }));
      const { restoreFactoryAutomationVersion } =
        await import("./factory-automation-history.js");
      const result = await restoreFactoryAutomationVersion(
        { ...restoreInput, historicalContent: historical },
        { ...context, userEmail: "owner@example.com" },
      );
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      expect(parseJobResource(result.resource.content).meta).toMatchObject({
        mcpManaged: true,
        lastRun: "latest",
        enabled: false,
      });
      expect(parseJobResource(result.resource.content).body).toBe(
        "Restored prompt.",
      );
      expect(
        result.resource.content.endsWith(
          `${lineEnding}${lineEnding}Restored prompt.${lineEnding}`,
        ),
      ).toBe(true);
      expect(result.resource.content).toContain("customFactory: retained");
      const header = result.resource.content.split(/\r?\n---/)[0];
      for (const key of [
        "mcpManaged",
        "lastRun",
        "enabled",
        "factoryId",
        "promptVersion",
      ]) {
        expect(
          header
            .split(/\r?\n/)
            .filter((line) => line.split(":")[0].trim() === key),
        ).toHaveLength(1);
      }
      expect(resourcePutIfCurrentMock.mock.calls[0][0]).toMatchObject({
        expectedContent: live,
        expectedUpdatedAt: 42,
      });
      expect(insertValuesMock.mock.calls[0][0].rawContent).toBe(live);
    },
  );

  it("restores ordinary unmarked CRLF settings", async () => {
    const live = currentContent.replace(/\n/g, "\r\n");
    resourceGetByPathMock.mockResolvedValue({
      ...resource,
      content: live,
      updatedAt: 42,
    });
    const { restoreFactoryAutomationVersion } =
      await import("./factory-automation-history.js");
    await restoreFactoryAutomationVersion(
      {
        ...restoreInput,
        historicalContent: historicalContent.replace(/\n/g, "\r\n"),
      },
      { caller: "frontend", userEmail: "owner@example.com" },
    );
    const { parseJobResource } =
      await import("@agent-native/core/jobs/frontmatter");
    expect(
      parseJobResource(resourcePutIfCurrentMock.mock.calls[0][0].content).meta
        .mcpManaged,
    ).toBeUndefined();
  });

  it.each(["Body only", "---\nenabled: false\nBody"])(
    "requires complete restored settings for %j",
    async (historicalContent) => {
      const { restoreFactoryAutomationVersion } =
        await import("./factory-automation-history.js");
      await expect(
        restoreFactoryAutomationVersion(
          { ...restoreInput, historicalContent },
          {
            caller: "tool",
            networkProtocol: "mcp",
            userEmail: "owner@example.com",
          },
        ),
      ).rejects.toThrow();
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
      expect(insertValuesMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { caller: "frontend" as const, historicalMarker: undefined },
    { caller: "frontend" as const, historicalMarker: false },
    { caller: "tool" as const, historicalMarker: undefined },
    { caller: "tool" as const, historicalMarker: false },
    {
      caller: "tool" as const,
      networkProtocol: "mcp" as const,
      historicalMarker: undefined,
    },
    {
      caller: "tool" as const,
      networkProtocol: "mcp" as const,
      historicalMarker: false,
    },
    {
      caller: "tool" as const,
      networkProtocol: "a2a" as const,
      historicalMarker: undefined,
    },
    {
      caller: "tool" as const,
      networkProtocol: "a2a" as const,
      historicalMarker: false,
    },
  ])(
    "retains the authoritative current marker for $caller/$networkProtocol with historical $historicalMarker",
    async ({ historicalMarker, ...context }) => {
      const live = currentContent.replace(
        "factoryId: myfact",
        "factoryId: myfact\nmcpManaged: true",
      );
      resourceGetByPathMock.mockResolvedValue({
        ...resource,
        content: live,
        updatedAt: 42,
      });
      const historical =
        historicalMarker === undefined
          ? historicalContent
          : historicalContent.replace(
              "factoryId: myfact",
              "factoryId: myfact\nmcpManaged: false",
            );
      resourcePutIfCurrentMock.mockImplementation(async (candidate) => ({
        ...resource,
        content: candidate.content,
        size: Buffer.byteLength(candidate.content),
        updatedAt: 43,
      }));
      const { restoreFactoryAutomationVersion } =
        await import("./factory-automation-history.js");
      const result = await restoreFactoryAutomationVersion(
        { ...restoreInput, historicalContent: historical },
        { ...context, userEmail: "owner@example.com" },
      );
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      expect(parseJobResource(result.resource.content).meta.mcpManaged).toBe(
        true,
      );
      expect(result.resource.content).toBe(
        resourcePutIfCurrentMock.mock.calls[0][0].content,
      );
      expect(result.resource.size).toBe(
        Buffer.byteLength(result.resource.content),
      );
      expect(resourcePutIfCurrentMock.mock.calls[0][0]).toMatchObject({
        expectedUpdatedAt: 42,
        expectedContent: live,
      });
      expect(insertValuesMock.mock.calls[0][0].rawContent).toBe(live);
    },
  );

  it.each(["rejected", "throws"] as const)(
    "cleans up the predecessor when the authoritative CAS %s",
    async (failure) => {
      if (failure === "rejected")
        resourcePutIfCurrentMock.mockResolvedValue(null);
      else
        resourcePutIfCurrentMock.mockRejectedValue(new Error("db unavailable"));
      const { restoreFactoryAutomationVersion } =
        await import("./factory-automation-history.js");
      await expect(
        restoreFactoryAutomationVersion(restoreInput, {
          caller: "frontend",
          userEmail: "owner@example.com",
        }),
      ).rejects.toThrow(
        failure === "rejected" ? "changed concurrently" : "db unavailable",
      );
      expect(insertValuesMock).toHaveBeenCalledOnce();
      expect(deleteReturningMock).toHaveBeenCalledOnce();
      expect(resourcePutIfCurrentMock.mock.calls[0][0]).toMatchObject({
        expectedId: "resource-1",
        expectedUpdatedAt: 42,
        expectedContent: currentContent,
      });
    },
  );

  it("uses the authoritative resource row for conditional writes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T13:00:00.000Z"));
    try {
      const { restoreFactoryAutomationVersion } =
        await import("./factory-automation-history.js");
      const result = await restoreFactoryAutomationVersion(
        {
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
        },
        { caller: "frontend", userEmail: "owner@example.com" },
      );

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
      await restoreFactoryAutomationVersion(
        {
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
        },
        { caller: "frontend", userEmail: "owner@example.com" },
      );
      return resourcePutIfCurrentMock.mock.calls[0]?.[0].content as string;
    };
    const tagged = (content: string, type: string) =>
      content.replace(
        "factoryId: myfact",
        `factoryId: myfact\ntriggerType: ${type}`,
      );

    const identified = (content: string) =>
      content.replace(
        "factoryId: myfact",
        "factoryId: myfact\ncreatedBy: alice@example.com\nrunAs: creator\norgId: org-1",
      );

    it("stamps triggerType: schedule when neither file has one", async () => {
      const written = await restoreWith(
        identified(currentContent),
        identified(historicalContent),
      );

      expect(written).toContain("triggerType: schedule");
    });

    it("keeps the live file's trigger type when the restored version predates it", async () => {
      const written = await restoreWith(
        tagged(identified(currentContent), "webhook"),
        identified(historicalContent),
      );

      expect(written.match(/^triggerType:.*$/gm)).toEqual([
        "triggerType: webhook",
      ]);
    });

    it("leaves a trigger type the restored version already has", async () => {
      const written = await restoreWith(
        tagged(identified(currentContent), "webhook"),
        tagged(identified(historicalContent), "event"),
      );

      expect(written.match(/^triggerType:.*$/gm)).toEqual([
        "triggerType: event",
      ]);
    });

    it("keeps the live file tagged when the restored version has no identity of its own", async () => {
      const written = await restoreWith(
        tagged(identified(currentContent), "schedule"),
        historicalContent,
      );

      expect(written).toContain("triggerType: schedule");
      expect(written).toContain("createdBy: alice@example.com");
      expect(written).toContain("orgId: org-1");
    });

    it("leaves the file untagged when neither version names a creator", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const written = await restoreWith(currentContent, historicalContent);

      expect(written).not.toContain("triggerType:");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("stays untagged after the restore"),
      );
      warn.mockRestore();
    });
  });
});
