import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const workspaceMock = vi.hoisted(() => vi.fn());
const getUserEmailMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/lib/workflow-action-support.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workflow-action-support.js")
  >()),
  requireWorkflowActionCaller: requireCallerMock,
}));
vi.mock("../server/connectors/slack-workflow.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/connectors/slack-workflow.js")
  >()),
  resolveFactorySlackWorkspace: workspaceMock,
}));
vi.mock("../server/triage/slack-client.js", () => ({
  createSlackWorkflowClient: createClientMock,
}));

import action from "./read-slack-user-email.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
  workspaceMock.mockResolvedValue("primary");
  createClientMock.mockReturnValue({ getUserEmail: getUserEmailMock });
  getUserEmailMock.mockResolvedValue({
    id: "U01REPORT01",
    email: "ada@example.test",
    isBot: false,
    grantedScopes: ["users:read.email"],
  });
});

describe("read-slack-user-email", () => {
  it("is a read-only action that only a workflow can call", () => {
    expect(action.readOnly).toBe(true);
    expect(action.http).toBe(false);
  });

  it("reads the email for the caller's workspace and its output matches the declared schema", async () => {
    workspaceMock.mockResolvedValue("secondary");

    const result = await action.run({ userId: "U01REPORT01" }, context);

    expect(action.outputSchema.parse(result)).toEqual({
      ok: true,
      userId: "U01REPORT01",
      email: "ada@example.test",
      emailSource: "slack",
    });
    expect(getUserEmailMock).toHaveBeenCalledWith("secondary", "U01REPORT01");
    expect(createClientMock).toHaveBeenCalledWith({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
    });
  });

  it("uses the fallback only for a person Slack says has no email", async () => {
    getUserEmailMock.mockResolvedValue({
      id: "U01REPORT01",
      email: null,
      isBot: false,
      grantedScopes: ["users:read.email"],
    });

    await expect(
      action.run(
        { userId: "U01REPORT01", fallbackEmail: "triage-owner@example.test" },
        context,
      ),
    ).resolves.toMatchObject({
      email: "triage-owner@example.test",
      emailSource: "fallback",
    });
  });

  it("never turns a failed lookup into the fallback", async () => {
    getUserEmailMock.mockRejectedValue(
      new Error("Slack API error: missing_scope"),
    );

    await expect(
      action.run(
        { userId: "U01REPORT01", fallbackEmail: "triage-owner@example.test" },
        context,
      ),
    ).rejects.toMatchObject({ errorCode: "slack_access_denied" });
  });
});
