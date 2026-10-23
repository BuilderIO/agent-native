import { parseJobResource } from "@agent-native/core/jobs/frontmatter";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAutomationConfig } from "../lib/factory-automation-config.js";

const deleteAutomationRunsMock = vi.hoisted(() => vi.fn());
const listAutomationDefinitionsMock = vi.hoisted(() => vi.fn());
const resourceDeleteByPathMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourceListMock = vi.hoisted(() => vi.fn());
const resourceListContentMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfAbsentMock = vi.hoisted(() => vi.fn());
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
const registerRecurringSweepHandlerMock = vi.hoisted(() => vi.fn());
const registerJobRunnerMock = vi.hoisted(() => vi.fn(() => () => {}));
const jobRunnerModuleLoadedMock = vi.hoisted(() => vi.fn());
const legacyJobsModuleLoadedMock = vi.hoisted(() => vi.fn());
const retireLegacyAgentJobsMock = vi.hoisted(() => vi.fn());
const createWorkflowJobRunnerMock = vi.hoisted(() => vi.fn());
const isProductionServerlessFunctionRuntimeMock = vi.hoisted(() =>
  vi.fn(() => false),
);

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
  resourcePutIfAbsent: resourcePutIfAbsentMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
  WORKSPACE_OWNER: "workspace",
}));

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  isProductionServerlessFunctionRuntime:
    isProductionServerlessFunctionRuntimeMock,
}));

vi.mock("@agent-native/core/server", () => ({
  defineNitroPlugin: (def: unknown) => def,
  registerRecurringSweepHandler: registerRecurringSweepHandlerMock,
  registerJobRunner: registerJobRunnerMock,
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
  createFactoryAutomation,
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
  resourcePutIfAbsentMock.mockReset().mockResolvedValue({ id: "new-job" });
  resourceDeleteByPathMock.mockResolvedValue(true);
  deleteAutomationRunsMock.mockResolvedValue(undefined);
  insertAutomationVersionValuesMock.mockResolvedValue(undefined);
  getDbMock.mockReturnValue({
    insert: () => ({ values: insertAutomationVersionValuesMock }),
    select: () => ({ from: () => ({ where: async () => [{ latest: null }] }) }),
  });
});

describe("createFactoryAutomation origin", () => {
  const input = {
    displayName: "Watch",
    prompt: "Watch this repository.",
    config: defaultAutomationConfig("github", "blank"),
  };

  it("requires a single-line timezone before creation", async () => {
    await expect(
      createFactoryAutomation(
        "owner@example.com",
        "org-1",
        "support-triage",
        {
          ...input,
          config: {
            ...input.config,
            repository: "example/project",
            scheduleMode: "daily",
            timezone: "UTC\nmcpTools: not-json",
          },
        },
        { caller: "tool", networkProtocol: "mcp" } as never,
      ),
    ).rejects.toMatchObject({
      actionContractError: true,
      statusCode: 400,
      errorCode: "invalid_request",
      message: expect.stringContaining("timezone"),
    });
    expect(resourcePutIfAbsentMock).not.toHaveBeenCalled();
    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(insertAutomationVersionValuesMock).not.toHaveBeenCalled();
  });

  it.each(
    [
      "displayName",
      "slackChannelId",
      "slackChannelName",
      "repository",
      "sentryOrgSlug",
      "sentryProjectSlug",
      "sentryEnvironment",
      "timezone",
    ].flatMap((field) =>
      ["\r", "\n", "\u0085", "\u2028", "\u2029"].map((separator) => ({
        field,
        separator,
      })),
    ),
  )(
    "requires single-line creation $field with separator $separator",
    async ({ field, separator }) => {
      const value = `Selected${separator}continued`;
      const settings = {
        ...input,
        config: {
          ...input.config,
          scheduleMode: "daily" as const,
          timezone: "UTC",
          [field]: value,
        },
        ...(field === "displayName" ? { displayName: value } : {}),
      };
      await expect(
        createFactoryAutomation(
          "owner@example.com",
          "org-1",
          "support-triage",
          settings,
          { caller: "tool", networkProtocol: "mcp" } as never,
        ),
      ).rejects.toMatchObject({
        actionContractError: true,
        statusCode: 400,
        errorCode: "invalid_request",
        message: expect.stringContaining(field),
      });
      expect(resourcePutIfAbsentMock).not.toHaveBeenCalled();
      expect(resourcePutMock).not.toHaveBeenCalled();
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
      expect(insertAutomationVersionValuesMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { caller: "tool" as const, networkProtocol: "mcp" as const },
    { caller: "tool" as const, networkProtocol: "a2a" as const },
    { caller: "cli" as const },
    undefined,
  ])(
    "marks outside-created definitions from %o using server context",
    async (context) => {
      await createFactoryAutomation(
        "owner@example.com",
        "org-1",
        "support-triage",
        {
          ...input,
          prompt: "---\nmcpManaged: false\n---\nWatch GitHub.",
        },
        context as never,
      );
      const content = resourcePutIfAbsentMock.mock.calls[0][2] as string;
      expect(parseJobResource(content).meta.mcpManaged).toBe(true);
      expect(
        content
          .split("\n---")[0]
          .split("\n")
          .filter((line) => line.split(":")[0].trim() === "mcpManaged"),
      ).toEqual(["mcpManaged: true"]);
      expect(resourcePutMock).not.toHaveBeenCalled();
    },
  );

  it.each(["frontend", "tool"] as const)(
    "keeps ordinary %s definitions unmarked despite input marker",
    async (caller) => {
      await createFactoryAutomation(
        "owner@example.com",
        "org-1",
        "support-triage",
        {
          ...input,
          mcpManaged: true,
        } as typeof input,
        { caller } as never,
      );
      expect(
        parseJobResource(resourcePutIfAbsentMock.mock.calls[0][2]).meta
          .mcpManaged,
      ).toBeUndefined();
    },
  );

  it("preserves an existing marked peer definition and retries a raced name without dropping origin", async () => {
    const existing = `---\norgId: org-1\ncreatedBy: peer@example.com\nrunAs: creator\nmcpManaged: true\nenabled: false\n---\nPeer job.\n`;
    resourceListContentMock.mockResolvedValue([
      {
        id: "peer-job",
        owner: "__organization__:org-1",
        path: "jobs/factories/support-triage/factory-github-watch.md",
        content: existing,
      },
    ]);
    resourcePutIfAbsentMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "new-job" });
    const result = await createFactoryAutomation(
      "owner@example.com",
      "org-1",
      "support-triage",
      input,
      { caller: "tool", networkProtocol: "mcp" } as never,
    );
    expect(resourcePutIfAbsentMock).toHaveBeenCalledTimes(2);
    const paths = resourcePutIfAbsentMock.mock.calls.map((call) => call[1]);
    expect(paths).toEqual([
      "jobs/factories/support-triage/factory-github-watch-2.md",
      "jobs/factories/support-triage/factory-github-watch-3.md",
    ]);
    expect(result.path).toBe(paths[1]);
    for (const call of resourcePutIfAbsentMock.mock.calls) {
      expect(parseJobResource(call[2]).meta.mcpManaged).toBe(true);
    }
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("accepts success on the fourth create attempt after three name races", async () => {
    resourcePutIfAbsentMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "fourth-job" });

    await expect(
      createFactoryAutomation(
        "owner@example.com",
        "org-1",
        "support-triage",
        input,
        { caller: "tool", networkProtocol: "mcp" } as never,
      ),
    ).resolves.toEqual({
      id: "fourth-job",
      name: "factory-github-watch-4",
      path: "jobs/factories/support-triage/factory-github-watch-4.md",
    });
    expect(resourcePutIfAbsentMock).toHaveBeenCalledTimes(4);
    expect(resourcePutIfAbsentMock.mock.calls.map((call) => call[1])).toEqual([
      "jobs/factories/support-triage/factory-github-watch.md",
      "jobs/factories/support-triage/factory-github-watch-2.md",
      "jobs/factories/support-triage/factory-github-watch-3.md",
      "jobs/factories/support-triage/factory-github-watch-4.md",
    ]);
    for (const call of resourcePutIfAbsentMock.mock.calls) {
      expect(parseJobResource(call[2]).meta.mcpManaged).toBe(true);
    }
    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("exhausts exactly four raced creates after scanning occupied names without overwriting a marked job", async () => {
    const occupiedPaths = [
      "jobs/factories/support-triage/factory-github-watch.md",
      "jobs/factories/support-triage/factory-github-watch-2.md",
      "jobs/factories/support-triage/factory-github-watch-3.md",
      "jobs/factories/support-triage/factory-github-watch-4.md",
      "jobs/factories/support-triage/factory-github-watch-5.md",
      "jobs/factories/support-triage/factory-github-watch-6.md",
    ];
    resourceListContentMock.mockResolvedValue(
      occupiedPaths.map((path, index) => ({
        id: `peer-job-${index}`,
        owner: "__organization__:org-1",
        path,
        content:
          "---\norgId: org-1\ncreatedBy: peer@example.com\nrunAs: creator\nmcpManaged: true\nenabled: false\n---\nPeer job.\n",
      })),
    );
    resourcePutIfAbsentMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "forbidden-fifth-job" });

    await expect(
      createFactoryAutomation(
        "owner@example.com",
        "org-1",
        "support-triage",
        input,
        { caller: "tool", networkProtocol: "a2a" } as never,
      ),
    ).rejects.toMatchObject({
      actionContractError: true,
      message:
        "Factory automation changed concurrently. Refresh and try again.",
      statusCode: 409,
      errorCode: "automation_version_conflict",
    });
    expect(resourcePutIfAbsentMock).toHaveBeenCalledTimes(4);
    expect(resourcePutIfAbsentMock.mock.calls.map((call) => call[1])).toEqual([
      "jobs/factories/support-triage/factory-github-watch-7.md",
      "jobs/factories/support-triage/factory-github-watch-8.md",
      "jobs/factories/support-triage/factory-github-watch-9.md",
      "jobs/factories/support-triage/factory-github-watch-10.md",
    ]);
    for (const call of resourcePutIfAbsentMock.mock.calls) {
      expect(parseJobResource(call[2]).meta.mcpManaged).toBe(true);
    }
    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });
});

describe("ensureFactoryAutomations", () => {
  it.each(["crlf", "headerless"])(
    "preserves compatible %s seed settings",
    async (format) => {
      const path = "jobs/factories/support-triage/factory-pr-governance.md";
      const content =
        format === "headerless"
          ? "Legacy prompt.\nSecond paragraph.\n"
          : [
              "---",
              'schedule: "15 10 * * *"',
              "enabled: false",
              "timezone: Pacific/Auckland",
              "source: github",
              "template: pr-governance",
              "repository: acme/widgets",
              "displayName: Custom governance",
              "scheduleMode: daily",
              "dailyTime: 10:15",
              "intervalMinutes: 60",
              "orgId: org-1",
              "createdBy: owner@example.com",
              "runAs: creator",
              "mcpManaged: true",
              "maxIterations: 9",
              "maxRunInputTokens: 54321",
              "---",
              "Custom prompt.",
              "",
            ].join("\r\n");
      resourceListContentMock.mockResolvedValue([
        { id: "compatible", owner: "__organization__:org-1", path, content },
      ]);
      resourceGetByPathMock.mockImplementation(
        (_owner: string, selectedPath: string) =>
          selectedPath === path
            ? {
                id: "compatible",
                owner: "__organization__:org-1",
                path,
                content,
                updatedAt: 42,
              }
            : null,
      );
      await expect(
        ensureFactoryAutomations(
          "owner@example.com",
          "org-1",
          "support-triage",
        ),
      ).resolves.toBeUndefined();
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
      expect(resourcePutMock).not.toHaveBeenCalled();
      expect(resourcePutIfAbsentMock).not.toHaveBeenCalled();
      expect(insertAutomationVersionValuesMock).not.toHaveBeenCalled();
      expect(resourceDeleteByPathMock).not.toHaveBeenCalled();
      if (format === "crlf")
        expect(parseJobResource(content).meta).toMatchObject({
          enabled: false,
          schedule: "15 10 * * *",
          timezone: "Pacific/Auckland",
          mcpManaged: true,
          maxIterations: 9,
          maxRunInputTokens: 54321,
        });
    },
  );

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

  it("leaves a workflow's job file alone, so a repair never rewrites its schedule", async () => {
    const path = "jobs/factories/support-triage/workflow-digest-1a2b3c4d.md";
    const content = `---
schedule: "0 8 * * 1-5"
enabled: true
triggerType: schedule
domain: factory
appId: factory
orgId: org-1
createdBy: owner@example.com
runAs: creator
runner: workflow
timezone: America/New_York
slackChannelId: C0DIGEST
---
Placeholder.
`;
    resourceListContentMock.mockResolvedValue([
      { id: "wf", owner: "__organization__:org-1", path, content },
    ]);
    resourceGetByPathMock.mockImplementation((_owner: string, p: string) =>
      p === path
        ? {
            id: "wf",
            owner: "__organization__:org-1",
            path,
            content,
            updatedAt: 1,
          }
        : null,
    );

    await ensureFactoryAutomations(
      "owner@example.com",
      "org-1",
      "support-triage",
    );

    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("never repairs or revives a retired seed job", async () => {
    for (const leaf of [
      "factory-slack-feedback",
      "factory-sentry-errors",
      "factory-github-issues",
      "factory-pr-babysit",
      "factory-pr-babysit-2",
    ]) {
      const path = `jobs/factories/support-triage/${leaf}.md`;
      const content = `---
schedule: "*/5 * * * *"
enabled: false
pausedReason: replaced_by_workflows
orgId: org-1
appId: factory
template: slack-feedback
source: slack
---
Retired prompt.
`;
      resourceListContentMock.mockResolvedValue([
        { id: leaf, owner: "__organization__:org-1", path, content },
      ]);
      resourceGetByPathMock.mockImplementation((_owner: string, p: string) =>
        p === path
          ? {
              id: leaf,
              owner: "__organization__:org-1",
              path,
              content,
              updatedAt: 1,
            }
          : null,
      );

      await ensureFactoryAutomations(
        "owner@example.com",
        "org-1",
        "support-triage",
      );
    }

    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
  });

  it("repairs a suffixed PR governance copy back to GitHub", async () => {
    const copyPath = "jobs/factories/support-triage/factory-pr-governance-2.md";
    const copyContent = `---
schedule: "*/5 * * * *"
enabled: false
orgId: org-1
appId: factory
template: pr-governance
repository: acme/widgets
source: slack
---
Review pull requests.
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
    expect(saved).toMatch(/^template: pr-governance$/m);
  });

  it("preserves automation display name, channel, and author filter during repair", async () => {
    const path = "jobs/factories/product-an-feedback/factory-pr-governance.md";
    const content = `---
schedule: "* * * * *"
enabled: true
orgId: org-1
appId: factory
template: pr-governance
source: github
repository: acme/widgets
displayName: Product feedback
slackChannelId: C0ATH3CCZT4
slackChannelName: product-feedback
authorMode: exclude
authorIds: 2721089
model: claude-sonnet-4-20250514
maxIterations: 20
maxRunInputTokens: 200000
---
Review pull requests.
`;
    resourceListContentMock.mockResolvedValue([
      {
        id: "governance",
        owner: "__organization__:org-1",
        path,
        content,
      },
    ]);
    resourceGetByPathMock.mockImplementation((_owner: string, p: string) => {
      if (p !== path) return null;
      return {
        id: "governance",
        owner: "__organization__:org-1",
        path,
        content,
        updatedAt: 1,
      };
    });
    resourcePutIfCurrentMock.mockResolvedValue({ id: "governance" });

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
    expect(saved).toContain("authorIds: 2721089");
    expect(saved).toContain("Review pull requests.");
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
    const path = "jobs/factories/product-an-feedback/factory-pr-governance.md";
    const customPrompt = "Only review pull requests from the docs team.";
    const content = `---
schedule: "* * * * *"
enabled: true
orgId: org-1
appId: factory
template: pr-governance
source: github
repository: acme/widgets
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
        id: "governance",
        owner: "__organization__:org-1",
        path,
        content,
      },
    ]);
    resourceGetByPathMock.mockImplementation((_owner: string, p: string) => {
      if (p !== path) return null;
      return {
        id: "governance",
        owner: "__organization__:org-1",
        path,
        content,
        updatedAt: 1,
      };
    });
    resourcePutIfCurrentMock.mockResolvedValue({ id: "governance" });

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
    expect(saved).not.toContain("# Factory pull-request governance");
  });

  it("recomposes duplicate alignment blocks while preserving identity and user prompt", async () => {
    const path = "jobs/factories/product-an-feedback/factory-pr-governance.md";
    const { managedReviewSkillAlignmentMarkers } =
      await import("../triage/review-skill-alignment.js");
    const { start, end } = managedReviewSkillAlignmentMarkers();
    const userPrompt = "Only triage paying customers.";
    const content = `---
schedule: "* * * * *"
enabled: true
orgId: org-1
appId: factory
template: pr-governance
source: github
repository: acme/widgets
displayName: Product feedback
slackChannelId: C0ATH3CCZT4
authorIds: 2721089
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
        id: "governance",
        owner: "__organization__:org-1",
        path,
        content,
      },
    ]);
    resourceGetByPathMock.mockImplementation((_owner: string, p: string) => {
      if (p !== path) return null;
      return {
        id: "governance",
        owner: "__organization__:org-1",
        path,
        content,
        updatedAt: 1,
      };
    });
    resourcePutIfCurrentMock.mockResolvedValue({ id: "governance" });

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
    expect(saved).toContain("authorIds: 2721089");
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

  it("offers no prompt for a template that was retired with its job", () => {
    for (const [template, source] of [
      ["slack-feedback", "slack"],
      ["github-issues", "github"],
      ["sentry-errors", "sentry"],
      ["pr-babysit", "github"],
    ] as const) {
      const prompt = factoryAutomationTemplatePrompt(template as never, source);
      expect(prompt).toBe(`# Factory ${source} automation\n`);
    }
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

describe("factory scheduler plugin", () => {
  function configDb(...limitResults: unknown[][]) {
    const limit = vi.fn();
    for (const rows of limitResults) limit.mockResolvedValueOnce(rows);
    const query = {
      from: () => query,
      where: () => query,
      limit,
    };
    return { select: () => query, limit };
  }

  async function loadPlugin() {
    vi.resetModules();
    // Registered fresh with each load, so a module the plugin pulls in at
    // import or init time is counted, not served from an earlier test's cache.
    vi.doMock("../workflow-host/job-runner.js", () => {
      jobRunnerModuleLoadedMock();
      return { createWorkflowJobRunner: createWorkflowJobRunnerMock };
    });
    vi.doMock("../lib/factory-legacy-agent-jobs.js", () => {
      legacyJobsModuleLoadedMock();
      return { retireLegacyAgentJobs: retireLegacyAgentJobsMock };
    });
    const plugin = await import("./factory-scheduler-job.js");
    const { repairFactoryAutomationsFromConfig } =
      await import("../lib/factory-automation-repair.js");
    return {
      plugin: plugin.default as unknown as () => Promise<void>,
      repairFactoryAutomationsFromConfig: vi.mocked(
        repairFactoryAutomationsFromConfig,
      ),
      sweepHandler: () => {
        const call = registerRecurringSweepHandlerMock.mock.calls.find(
          ([id]) => id === "factory-automation-repair",
        );
        if (!call) throw new Error("repair sweep handler was not registered");
        return call[1] as () => Promise<void>;
      },
    };
  }

  beforeEach(() => {
    vi.stubEnv("WORKSPACE_OWNER_EMAIL", "");
    resourceGetByPathMock.mockResolvedValue(null);
  });

  it("leaves the repair to the durable sweep on a serverless request function", async () => {
    isProductionServerlessFunctionRuntimeMock.mockReturnValue(true);
    const { plugin } = await loadPlugin();

    await plugin();

    expect(registerRecurringSweepHandlerMock).toHaveBeenCalledWith(
      "factory-automation-repair",
      expect.any(Function),
    );
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("registers the workflow runner once, before the serverless return, and does nothing else at init", async () => {
    isProductionServerlessFunctionRuntimeMock.mockReturnValue(true);
    const { plugin } = await loadPlugin();

    await plugin();

    expect(registerJobRunnerMock).toHaveBeenCalledTimes(1);
    expect(registerJobRunnerMock).toHaveBeenCalledWith(
      "workflow",
      expect.any(Function),
    );
    expect(registerRecurringSweepHandlerMock).toHaveBeenCalledTimes(1);
    // Registering touched no database, listed no job file, and did not load the engine.
    expect(getDbMock).not.toHaveBeenCalled();
    expect(resourceListMock).not.toHaveBeenCalled();
    expect(resourceListContentMock).not.toHaveBeenCalled();
    expect(jobRunnerModuleLoadedMock).not.toHaveBeenCalled();
    expect(createWorkflowJobRunnerMock).not.toHaveBeenCalled();
  });

  it("never retires the legacy agent jobs at init, on either runtime", async () => {
    for (const serverless of [true, false]) {
      vi.clearAllMocks();
      isProductionServerlessFunctionRuntimeMock.mockReturnValue(serverless);
      const { plugin } = await loadPlugin();
      getDbMock.mockReturnValue(
        configDb(
          [{ id: "org-1", ownerEmail: "owner@example.com", orgId: "org-1" }],
          [{ id: "org-1:product-feedback" }],
        ),
      );

      await plugin();

      expect(legacyJobsModuleLoadedMock).not.toHaveBeenCalled();
      expect(retireLegacyAgentJobsMock).not.toHaveBeenCalled();
      expect(resourcePutMock).not.toHaveBeenCalled();
      expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
    }
  });

  it("registers it on a long-lived server too, still exactly once", async () => {
    isProductionServerlessFunctionRuntimeMock.mockReturnValue(false);
    const { plugin } = await loadPlugin();
    getDbMock.mockReturnValue(
      configDb(
        [{ id: "org-1", ownerEmail: "owner@example.com", orgId: "org-1" }],
        [{ id: "org-1:product-feedback" }],
      ),
    );

    await plugin();

    expect(registerJobRunnerMock).toHaveBeenCalledTimes(1);
    expect(registerJobRunnerMock).toHaveBeenCalledWith(
      "workflow",
      expect.any(Function),
    );
  });

  it("loads the engine on the first tick and hands it the scheduler's context", async () => {
    isProductionServerlessFunctionRuntimeMock.mockReturnValue(true);
    const { plugin } = await loadPlugin();
    await plugin();
    const tick = vi.fn(async () => ({ status: "success" as const }));
    createWorkflowJobRunnerMock.mockReturnValue(tick);
    const registered = registerJobRunnerMock.mock.calls[0] as unknown as [
      string,
      (ctx: unknown) => Promise<unknown>,
    ];
    const ctx = { historyId: "history-1" };

    const result = await registered[1](ctx);

    expect(result).toEqual({ status: "success" });
    expect(jobRunnerModuleLoadedMock).toHaveBeenCalledTimes(1);
    expect(createWorkflowJobRunnerMock).toHaveBeenCalledWith(undefined);
    expect(tick).toHaveBeenCalledWith(ctx);
  });

  it("retries a failed sweep repair and stops once it succeeds", async () => {
    isProductionServerlessFunctionRuntimeMock.mockReturnValue(true);
    const { plugin, repairFactoryAutomationsFromConfig, sweepHandler } =
      await loadPlugin();
    await plugin();
    const db = configDb(
      [],
      [{ id: "org-1", ownerEmail: "Owner@Example.com", orgId: "org-1" }],
      [{ id: "org-1:product-feedback" }],
    );
    getDbMock.mockReturnValue(db);

    await expect(sweepHandler()()).rejects.toThrow(/WORKSPACE_OWNER_EMAIL/);
    await sweepHandler()();
    await sweepHandler()();

    expect(db.limit).toHaveBeenCalledTimes(3);
    expect(repairFactoryAutomationsFromConfig).toHaveBeenCalledTimes(1);
    expect(repairFactoryAutomationsFromConfig).toHaveBeenCalledWith(
      "owner@example.com",
      "org-1",
      "product-feedback",
    );
  });

  it("repairs inline once on a long-lived server", async () => {
    isProductionServerlessFunctionRuntimeMock.mockReturnValue(false);
    const { plugin, repairFactoryAutomationsFromConfig, sweepHandler } =
      await loadPlugin();
    getDbMock.mockReturnValue(
      configDb(
        [{ id: "org-1", ownerEmail: "owner@example.com", orgId: "org-1" }],
        [{ id: "org-1:product-feedback" }],
      ),
    );

    await plugin();
    await sweepHandler()();

    expect(repairFactoryAutomationsFromConfig).toHaveBeenCalledTimes(1);
  });
});
