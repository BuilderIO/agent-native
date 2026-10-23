import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithoutExecutionFence } from "../../../packages/core/src/agent/execution-fence.js";
import { executeAgentToolCall } from "../../../packages/core/src/agent/production-agent.js";
import { withMigrationRuntime } from "../../../packages/core/src/db/migrations.js";
import { settingsStore } from "../../../packages/core/src/settings/store.js";

const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const resolveMock = vi.hoisted(() => vi.fn());
const versionMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const insertValuesMock = vi.hoisted(() => vi.fn());
const deleteReturningMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const findDefinitionMock = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/factory-automation-resources.js", () => ({
  findFactoryAutomationDefinition: findDefinitionMock,
}));
vi.mock("../server/connectors/credentials.js", () => ({
  assertFactoryConnectorReady: vi.fn(),
  VaultUnavailableError: class VaultUnavailableError extends Error {},
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: (context: unknown) => context,
}));
vi.mock(
  "../server/lib/factory-automation-history.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/lib/factory-automation-history.js")
    >()),
    resolveFactoryAutomationForHistory: resolveMock,
    getFactoryAutomationVersionRow: versionMock,
  }),
);
vi.mock("../server/db/index.js", () => ({ getDb: getDbMock }));
vi.mock("@agent-native/core/resources", () => ({
  resourceGetByPath: resourceGetByPathMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
}));

const currentContent = `---
factoryId: myfact
createdBy: owner@example.com
orgId: org-1
runAs: creator
triggerType: schedule
promptVersion: 2
enabled: false
source: slack
slackChannelId: C123
---
Current prompt.
`;
const historicalContent = currentContent
  .replace("promptVersion: 2", "promptVersion: 1")
  .replace("Current prompt.", "Restored prompt.");
const resource = {
  id: "resource-1",
  owner: "__organization__:org-1",
  path: "jobs/factories/myfact/factory-slack-feedback.md",
  content: currentContent,
  mimeType: "text/markdown",
  size: Buffer.byteLength(currentContent),
  createdAt: 0,
  updatedAt: 42,
  createdBy: "system",
  visibility: "workspace" as const,
  threadId: null,
  runId: null,
  expiresAt: null,
  metadata: null,
};
const input = { automationId: "resource-1", versionId: "version-1" };

beforeAll(async () => {
  await import("./restore-factory-automation-version.js");
  await import("./save-factory-automation.js");
  await import("./get-factory-automation-version.js");
  await withMigrationRuntime(() => settingsStore.ready());
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "teammate@example.com",
    orgId: "org-1",
  });
  resolveMock.mockResolvedValue({
    resource,
    name: "factory-slack-feedback",
    factoryId: "myfact",
  });
  versionMock.mockResolvedValue({
    id: "version-1",
    automationId: "resource-1",
    version: 1,
    rawContent: historicalContent,
  });
  resourceGetByPathMock.mockResolvedValue(resource);
  resourcePutIfCurrentMock.mockImplementation(async (candidate) => ({
    ...resource,
    content: candidate.content,
    size: Buffer.byteLength(candidate.content),
    updatedAt: 43,
  }));
  insertValuesMock.mockResolvedValue(undefined);
  deleteReturningMock.mockResolvedValue([{ id: "deleted-version" }]);
  getDbMock.mockReturnValue({
    select: () => ({ from: () => ({ where: async () => [{ latest: 1 }] }) }),
    insert: () => ({ values: insertValuesMock }),
    delete: () => ({ where: () => ({ returning: deleteReturningMock }) }),
  });
});

describe("restore-factory-automation-version", () => {
  it("previews a headerless saved version without effects", async () => {
    versionMock.mockResolvedValue({
      id: "version-1",
      automationId: "resource-1",
      factoryId: "myfact",
      version: 1,
      rawContent: "Stored prompt.\nSecond paragraph.",
    });
    const { default: preview } =
      await import("./get-factory-automation-version.js");
    await expect(
      preview.run(input, {
        caller: "frontend",
        userEmail: "teammate@example.com",
      }),
    ).resolves.toMatchObject({
      rawContent: "Stored prompt.\nSecond paragraph.",
      userPrompt: "Stored prompt.\nSecond paragraph.",
      promptVersion: 0,
    });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("keeps marked CRLF settings through save, restore and preview", async () => {
    const { parseJobResource } =
      await import("@agent-native/core/jobs/frontmatter");
    const original = currentContent
      .replace(
        "factoryId: myfact",
        "factoryId: myfact\nmcpManaged: true\ncustomFactory: retained",
      )
      .replace(/\n/g, "\r\n");
    let live = {
      ...resource,
      content: original,
      size: Buffer.byteLength(original),
    };
    const rows = new Map<
      string,
      {
        id: string;
        automationId: string;
        factoryId: string;
        version: number;
        rawContent: string;
      }
    >([
      [
        "version-1",
        {
          id: "version-1",
          automationId: "resource-1",
          factoryId: "myfact",
          version: 1,
          rawContent: historicalContent,
        },
      ],
    ]);
    resourceGetByPathMock.mockImplementation(async () => live);
    resolveMock.mockImplementation(async () => ({
      resource: live,
      name: "factory-slack-feedback",
      factoryId: "myfact",
    }));
    findDefinitionMock.mockImplementation(async () => ({
      resource: live,
      name: "factory-slack-feedback",
      meta: { triggerType: "schedule" },
    }));
    versionMock.mockImplementation(async ({ id }) => rows.get(id));
    insertValuesMock.mockImplementation(async (row) => {
      rows.set(row.id, row);
    });
    resourcePutIfCurrentMock.mockImplementation(async (candidate) => {
      expect(candidate.expectedContent).toBe(live.content);
      live = {
        ...live,
        content: candidate.content,
        updatedAt: live.updatedAt + 1,
        size: Buffer.byteLength(candidate.content),
      };
      return live;
    });
    const context = {
      caller: "frontend" as const,
      userEmail: "teammate@example.com",
    };
    const { default: save } = await import("./save-factory-automation.js");
    const { default: restore } =
      await import("./restore-factory-automation-version.js");
    const { default: preview } =
      await import("./get-factory-automation-version.js");
    await save.run(
      {
        factoryId: "myfact",
        automationId: "resource-1",
        name: "factory-slack-feedback",
        prompt: "Saved prompt.\nSecond paragraph.",
        enabled: false,
      },
      context,
    );
    expect(parseJobResource(live.content).meta.mcpManaged).toBe(true);
    expect(parseJobResource(live.content).body).toContain(
      "Saved prompt.\nSecond paragraph.",
    );
    const predecessor = [...rows.values()].find(
      (row) => row.rawContent === original,
    )!;
    expect(predecessor.rawContent).toBe(original);
    await restore.run(input, context);
    expect(parseJobResource(live.content).meta.mcpManaged).toBe(true);
    const writes = resourcePutIfCurrentMock.mock.calls.length;
    const insertions = insertValuesMock.mock.calls.length;
    const selected = {
      automationId: "resource-1",
      versionId: predecessor.id as string,
    };
    const historical = await preview.run(selected, context);
    expect(historical.rawContent).toBe(original);
    expect(resourcePutIfCurrentMock).toHaveBeenCalledTimes(writes);
    expect(insertValuesMock).toHaveBeenCalledTimes(insertions);
    await restore.run(selected, context);
    expect(parseJobResource(live.content).meta.mcpManaged).toBe(true);
    expect(live.content).toContain("customFactory: retained");
    expect(parseJobResource(live.content).body).toBe("Current prompt.");
  });
  it.each([
    {
      settings: "mcpManaged: true\n mcpManaged : false",
      caller: "frontend" as const,
    },
    {
      settings: " mcpManaged : false\nmcpManaged: true",
      caller: "tool" as const,
    },
    {
      settings: "mcpManaged: false\n mcpManaged : false",
      caller: "tool" as const,
      networkProtocol: "mcp" as const,
    },
    {
      settings: "mcpManaged: false\n mcpManaged : false",
      caller: "tool" as const,
      networkProtocol: "a2a" as const,
    },
  ])(
    "restores selected version settings for $caller/$networkProtocol",
    async ({ settings, ...context }) => {
      const live = currentContent.replace(/\n/g, "\r\n");
      resourceGetByPathMock.mockResolvedValue({ ...resource, content: live });
      versionMock.mockResolvedValue({
        id: "version-1",
        automationId: "resource-1",
        version: 1,
        rawContent: historicalContent
          .replace(
            "factoryId: myfact",
            `factoryId: myfact\n${settings}\ncustomFactory: retained`,
          )
          .replace(/\n/g, "\r\n"),
      });
      const { default: action } =
        await import("./restore-factory-automation-version.js");
      const result = await action.run(input, {
        ...context,
        userEmail: "teammate@example.com",
      });
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      const saved = resourcePutIfCurrentMock.mock.calls[0][0];
      expect(result).toMatchObject({ ok: true, restoredFromVersion: 1 });
      expect(parseJobResource(saved.content).meta).toMatchObject({
        mcpManaged: true,
        enabled: false,
      });
      expect(parseJobResource(saved.content).body).toBe("Restored prompt.");
      expect(saved.content).toContain("customFactory: retained");
      expect(saved.expectedContent).toBe(live);
      expect(insertValuesMock.mock.calls[0][0].rawContent).toBe(live);
    },
  );

  it.each(["mcp", "a2a"] as const)(
    "pauses tool over %s before restore/history and stamps the approved candidate",
    async (networkProtocol) => {
      const { default: action } =
        await import("./restore-factory-automation-version.js");
      const call = (args = input, approvedToolCalls?: string[]) =>
        runWithoutExecutionFence(() =>
          executeAgentToolCall({
            actions: { "restore-factory-automation-version": action },
            name: "restore-factory-automation-version",
            callId: "restore-factory",
            input: args,
            caller: "tool",
            networkProtocol,
            ownerEmail: "teammate@example.com",
            approvedToolCalls,
            consumeApproval: async () => true,
          }),
        );
      const paused = await call();
      expect(paused.status).toBe("approval_required");
      expect(requireWorkspaceMemberMock).not.toHaveBeenCalled();
      expect(resolveMock).not.toHaveBeenCalled();
      expect(versionMock).not.toHaveBeenCalled();
      expect(insertValuesMock).not.toHaveBeenCalled();
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
      if (paused.status !== "approval_required")
        throw new Error("Missing approval");
      expect(
        (
          await call({ ...input, versionId: "another-version" }, [
            paused.approvalKey,
          ])
        ).status,
      ).toBe("approval_required");
      expect(insertValuesMock).not.toHaveBeenCalled();
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
      expect((await call(input, [paused.approvalKey])).status).toBe(
        "completed",
      );
      expect(resourcePutIfCurrentMock).toHaveBeenCalledOnce();
      expect(insertValuesMock).toHaveBeenCalledOnce();
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      expect(
        parseJobResource(resourcePutIfCurrentMock.mock.calls[0][0].content).meta
          .mcpManaged,
      ).toBe(true);
      expect(insertValuesMock.mock.calls[0][0].rawContent).toBe(currentContent);
    },
  );

  it.each(["frontend", "tool"] as const)(
    "allows an ordinary %s restore without marking it",
    async (caller) => {
      const { default: action } =
        await import("./restore-factory-automation-version.js");
      const result = await runWithoutExecutionFence(() =>
        executeAgentToolCall({
          actions: { "restore-factory-automation-version": action },
          name: "restore-factory-automation-version",
          callId: "ordinary-restore",
          input,
          caller,
          ownerEmail: "teammate@example.com",
        }),
      );
      expect(result.status).toBe("completed");
      expect(resourcePutIfCurrentMock).toHaveBeenCalledOnce();
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      expect(
        parseJobResource(resourcePutIfCurrentMock.mock.calls[0][0].content).meta
          .mcpManaged,
      ).toBeUndefined();
    },
  );

  it.each(["mcp", "a2a"] as const)(
    "stamps an unmarked outside %s restore through the real helper",
    async (networkProtocol) => {
      const { default: action } =
        await import("./restore-factory-automation-version.js");
      await action.run(input, {
        caller: "tool",
        networkProtocol,
        userEmail: "teammate@example.com",
      });
      const { parseJobResource } =
        await import("@agent-native/core/jobs/frontmatter");
      expect(
        parseJobResource(resourcePutIfCurrentMock.mock.calls[0][0].content).meta
          .mcpManaged,
      ).toBe(true);
    },
  );

  it("rejects a version belonging to another automation before effects", async () => {
    versionMock.mockResolvedValue({ automationId: "other-automation" });
    const { default: action } =
      await import("./restore-factory-automation-version.js");
    await expect(
      action.run(input, {
        caller: "frontend",
        userEmail: "teammate@example.com",
      }),
    ).rejects.toThrow("Factory automation version not found.");
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });
});
