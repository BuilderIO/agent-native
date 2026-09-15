import { describe, expect, it } from "vitest";

import { defineAction } from "../action.js";
import { checkAction, type ActionAccessConfig } from "./check-action.js";

describe("checkAction", () => {
  it("allows an action with no access contract", async () => {
    await expect(
      checkAction(undefined, {}, { caller: "frontend" }),
    ).resolves.toEqual({
      allowed: true,
      reason: "No action access policy.",
    });
  });

  it("denies an app contract without a resolved app identity", async () => {
    await expect(
      checkAction({ scope: "app" }, {}, { caller: "frontend" }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "This action has no resolved application identity.",
    });
  });

  it("denies an organization contract without an authenticated member", async () => {
    await expect(
      checkAction({ scope: "org" }, {}, { caller: "frontend" }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "The caller is not an active member of this organization.",
    });
  });

  it("denies a resource contract without a resource definition", async () => {
    await expect(
      checkAction(
        { scope: "resource" } as ActionAccessConfig,
        {},
        { caller: "frontend" },
      ),
    ).resolves.toEqual({
      allowed: false,
      reason: "This action has an invalid resource access policy.",
    });
  });

  it("enforces a declarative contract before the action body", async () => {
    const action = defineAction({
      description: "Needs an app identity.",
      access: { scope: "app" },
      run: () => "unreachable",
    });
    await expect(action.run({}, { caller: "frontend" })).rejects.toThrow(
      "resolved application identity",
    );
  });
});
