import { ActionContractError } from "@agent-native/core/action";
import { describe, expect, it, vi } from "vitest";

const verifyCuratedCommunityApp = vi.hoisted(() => vi.fn());

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
  verifyCuratedCommunityApp,
}));

import action from "./verify-curated-community-app.js";

const input = {
  sourceId: "reviewed-source",
  appId: "community-app",
  branchName: "release/community-app",
};

describe("verify-curated-community-app action", () => {
  it("allows a human-backed agent tool call to run the owner and readback checks", async () => {
    const receipt = {
      projectId: "project-1",
      branchName: "release/community-app",
      commitSha: "a".repeat(40),
      sourceId: input.sourceId,
      appId: input.appId,
      files: [],
      verified: true as const,
    };
    verifyCuratedCommunityApp.mockResolvedValue(receipt);

    await expect(action.run(input, { caller: "tool" })).resolves.toEqual(
      receipt,
    );
    expect(verifyCuratedCommunityApp).toHaveBeenCalledWith(input);
  });

  it.each([
    ["A2A", { caller: "a2a" as const }],
    [
      "A2A protocol",
      { caller: "tool" as const, networkProtocol: "a2a" as const },
    ],
    ["automation", { caller: "automation" as const }],
    ["widget capability", { caller: "mcp-widget-write" as const }],
  ])("rejects %s calls before readback", async (_name, context) => {
    verifyCuratedCommunityApp.mockClear();
    await expect(action.run(input, context)).rejects.toMatchObject({
      errorCode: "community_verification_identity_required",
      statusCode: 403,
    });
    expect(verifyCuratedCommunityApp).not.toHaveBeenCalled();
  });
});
