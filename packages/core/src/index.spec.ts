import { describe, expect, it } from "vitest";
import { z } from "zod";

import * as actionCaller from "./action-caller.js";
import * as browser from "./index.browser.js";
import * as sdk from "./index.js";
import { directHttpActionApprovalRefusal } from "./server/action-approval.js";

describe("public server SDK approval policy", () => {
  it.each(["mcp", "a2a"] as const)(
    "supports tool calls over %s without changing ordinary tool policy",
    async (networkProtocol) => {
      const action = sdk.defineAction({
        schema: z.object({ value: z.string() }),
        needsApproval: (_input, ctx) => sdk.isOutsideAgentCall(ctx),
        run: async ({ value }) => ({ value }),
      });
      const context = {
        actionName: "update-example",
        caller: "tool" as const,
        userEmail: "owner@example.com",
      };

      await expect(
        directHttpActionApprovalRefusal(
          action,
          { value: "example" },
          {
            ...context,
            networkProtocol,
          },
        ),
      ).resolves.toMatchObject({
        statusCode: 409,
        errorCode: "approval_required",
      });
      await expect(
        directHttpActionApprovalRefusal(action, { value: "example" }, context),
      ).resolves.toBeNull();
    },
  );
});

describe("core export surface", () => {
  it("re-exports the outside-agent check that app approval gates use", () => {
    expect(sdk.isOutsideAgentCall).toBe(actionCaller.isOutsideAgentCall);
  });

  it("re-exports the outside-agent check from the browser entry too", () => {
    expect(browser.isOutsideAgentCall).toBe(actionCaller.isOutsideAgentCall);
  });
});
