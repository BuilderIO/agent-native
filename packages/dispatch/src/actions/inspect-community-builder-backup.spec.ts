import { ActionContractError } from "@agent-native/core/action";
import { checkActionProperties } from "@agent-native/core/action-properties";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inspectCommunityBuilderBackup = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/community-install-verification.js", () => ({
  communityInstallVerificationErrors: {
    codes: ["community_verification_identity_required"],
    fail: (
      message: string,
      errorCode: string,
      options: { statusCode: number },
    ) => {
      throw new ActionContractError(message, {
        errorCode,
        statusCode: options.statusCode,
      });
    },
  },
  inspectCommunityBuilderBackup,
}));

import action from "./inspect-community-builder-backup.js";

const input = { branchName: "release/community-app" };

describe("inspect-community-builder-backup action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a read-only GET action and returns status without verification", async () => {
    const status = {
      branchName: input.branchName,
      branchState: "active" as const,
      backupPartial: true,
      backupValid: true,
      backupComplete: true,
      backupCurrent: true,
      agentIdle: true,
      hasUnpushedChanges: false,
      verificationPerformed: false as const,
    };
    inspectCommunityBuilderBackup.mockResolvedValue(status);

    await expect(action.run(input, { caller: "tool" })).resolves.toEqual(
      status,
    );
    expect(action.readOnly).toBe(true);
    expect(action.http).toEqual({ method: "GET" });
    expect(inspectCommunityBuilderBackup).toHaveBeenCalledExactlyOnceWith(
      input,
    );
  });

  it("satisfies generated action input and output contracts", async () => {
    inspectCommunityBuilderBackup.mockImplementation(
      async ({ branchName }) => ({
        branchName,
        branchState: "archived" as const,
        backupPartial: true,
        backupValid: true,
        backupComplete: true,
        backupCurrent: false,
        agentIdle: false,
        hasUnpushedChanges: true,
        verificationPerformed: false,
      }),
    );

    await checkActionProperties(action, {
      context: { caller: "tool" },
      runs: 5,
      seed: 19,
    });
  });

  it.each([
    ["A2A", { caller: "a2a" as const }],
    [
      "A2A protocol",
      { caller: "tool" as const, networkProtocol: "a2a" as const },
    ],
    ["automation", { caller: "automation" as const }],
    ["widget", { caller: "mcp-widget" as const }],
    ["widget capability", { caller: "mcp-widget-write" as const }],
  ])(
    "rejects %s calls before Builder status inspection",
    async (_name, context) => {
      await expect(action.run(input, context)).rejects.toMatchObject({
        errorCode: "community_verification_identity_required",
        statusCode: 403,
      });
      expect(inspectCommunityBuilderBackup).not.toHaveBeenCalled();
    },
  );
});
