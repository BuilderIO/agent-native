import { beforeEach, describe, expect, it, vi } from "vitest";

const requireWorkspaceMemberMock = vi.hoisted(() => vi.fn());
const workspaceMemberIdentityFromContextMock = vi.hoisted(() => vi.fn());
const getEmailReadinessMock = vi.hoisted(() => vi.fn());
const resolveFactoryConnectorReadinessMock = vi.hoisted(() => vi.fn());
const readTriageConfigRowMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/server", () => ({
  getEmailReadiness: getEmailReadinessMock,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: getDbMock,
}));

vi.mock("../server/lib/factory-scope.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/lib/factory-scope.js")>();
  return {
    ...actual,
    readTriageConfigRow: readTriageConfigRowMock,
  };
});

vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: requireWorkspaceMemberMock,
  workspaceMemberIdentityFromContext: workspaceMemberIdentityFromContextMock,
}));

vi.mock("../server/connectors/credentials.js", () => ({
  resolveFactoryConnectorReadiness: resolveFactoryConnectorReadinessMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  requireWorkspaceMemberMock.mockResolvedValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
  workspaceMemberIdentityFromContextMock.mockReturnValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
  getEmailReadinessMock.mockResolvedValue({ ready: true });
  getDbMock.mockReturnValue({});
  readTriageConfigRowMock.mockResolvedValue({
    builderSlackUserId: "U123",
    slackWorkspace: "primary",
    slackChannelId: "C123",
    slackChannelName: "feedback",
    pollingEnabled: 1,
    lastSlackTs: null,
    slackHistoryCursor: null,
    repository: null,
    githubPollingEnabled: 0,
    sentryPollingEnabled: 0,
    sentryOrgSlug: null,
    sentryProjectSlug: null,
    sentryEnvironment: null,
    lastSentrySeenAt: null,
    automationFailureAlertsEnabled: 1,
    automationFailureAlertEmail: null,
  });
  resolveFactoryConnectorReadinessMock.mockResolvedValue({
    slack: true,
    slackSecondary: false,
    github: false,
    sentry: false,
  });
});

describe("get-triage-config", () => {
  it("returns inbox settings even when connector readiness fails", async () => {
    resolveFactoryConnectorReadinessMock.mockRejectedValue(
      new Error("vault timeout"),
    );
    const { default: action } = await import("./get-triage-config.js");
    const result = await action.run(
      { factoryId: "support-triage" },
      { userEmail: "owner@example.com" },
    );

    expect(result).toMatchObject({
      factoryId: "support-triage",
      builderSlackUserId: "U123",
      pollingEnabled: true,
      readinessError: "vault timeout",
    });
    expect(result).not.toHaveProperty("connections");
    expect(readTriageConfigRowMock).toHaveBeenCalled();
  });

  it("attaches connections when connector readiness succeeds", async () => {
    const { default: action } = await import("./get-triage-config.js");
    const result = await action.run(
      { factoryId: "support-triage" },
      { userEmail: "owner@example.com" },
    );

    expect(result).toMatchObject({
      factoryId: "support-triage",
      builderSlackUserId: "U123",
      connections: {
        slack: true,
        slackSecondary: false,
        github: false,
        sentry: false,
      },
    });
    expect(result).not.toHaveProperty("readinessError");
  });
});
