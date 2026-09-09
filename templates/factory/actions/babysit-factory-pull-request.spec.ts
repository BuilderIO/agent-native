import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const requireFactoryAutomationMock = vi.hoisted(() => vi.fn());
const readCallingFactoryAutomationMock = vi.hoisted(() => vi.fn());
const readTriageConfigRowMock = vi.hoisted(() => vi.fn());
const createGitHubClientMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
}));

vi.mock("../server/factory-graph/store.js", () => ({
  DEFAULT_FACTORY_ID: "product-feedback",
}));

vi.mock("../server/lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: readCallingFactoryAutomationMock,
}));

vi.mock("../server/lib/factory-scope.js", () => ({
  factoryIdSchema: z.string(),
  factoryStillPresent: vi.fn().mockResolvedValue(true),
  readTriageConfigRow: readTriageConfigRowMock,
  requireExistingFactory: vi.fn(),
}));

vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: requireFactoryAutomationMock,
}));

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: (context: unknown) => context,
}));

vi.mock("../server/triage/audit.js", () => ({
  recordFactoryAudit: vi.fn(),
}));

vi.mock("../server/triage/github-client.js", () => ({
  createGitHubClient: createGitHubClientMock,
}));

const context = {
  caller: "automation" as const,
  userEmail: "owner@example.com",
  orgId: "org-1",
};

const input = {
  itemId: "item-1",
  factoryId: "testingfactory",
  inScope: true,
};

function automation(repository: string | null) {
  return {
    name: "factories/testingfactory/factory-pr-babysit",
    content: "",
    config: { repository },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
    role: "owner",
  });
  requireFactoryAutomationMock.mockResolvedValue(undefined);
  getDbMock.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              id: "item-1",
              factoryId: "testingfactory",
              source: "github",
              repository: "BuilderIO/agent-native",
              pullRequestNumber: 3749,
              sourceUrl: "https://github.com/BuilderIO/agent-native/pull/3749",
              metadataJson: "{}",
            },
          ],
        }),
      }),
    }),
  });
  // Reaching the GitHub client is the signal that the repository gate passed;
  // the evidence fetch itself is not what these cases exercise.
  createGitHubClientMock.mockReturnValue({
    getPullRequestSummary: () => {
      throw new Error("reached-github-evidence");
    },
  });
});

describe("babysit-factory-pull-request repository scope", () => {
  it("accepts the automation's repository when the factory config has none", async () => {
    const { default: action } =
      await import("./babysit-factory-pull-request.js");
    readCallingFactoryAutomationMock.mockResolvedValue(
      automation("https://github.com/BuilderIO/agent-native"),
    );
    readTriageConfigRowMock.mockResolvedValue({ repository: null });

    await expect(action.run(input, context)).rejects.toThrow(
      "reached-github-evidence",
    );
  });

  it("falls back to the factory config when the automation has no repository", async () => {
    const { default: action } =
      await import("./babysit-factory-pull-request.js");
    readCallingFactoryAutomationMock.mockResolvedValue(automation(null));
    readTriageConfigRowMock.mockResolvedValue({
      repository: "BuilderIO/agent-native",
    });

    await expect(action.run(input, context)).rejects.toThrow(
      "reached-github-evidence",
    );
  });

  it("still refuses an item from another repository", async () => {
    const { default: action } =
      await import("./babysit-factory-pull-request.js");
    readCallingFactoryAutomationMock.mockResolvedValue(
      automation("BuilderIO/other-repo"),
    );
    readTriageConfigRowMock.mockResolvedValue({ repository: null });

    await expect(action.run(input, context)).rejects.toThrow(
      "PR babysitting is restricted to the configured Factory repository.",
    );
  });
});
