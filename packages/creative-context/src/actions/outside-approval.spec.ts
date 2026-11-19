import type { ActionRunContext } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

import continueContextImport from "./continue-context-import.js";
import manageContextMembership from "./manage-context-membership.js";
import manageContextPack from "./manage-context-pack.js";
import manageCreativeContext from "./manage-creative-context.js";
import processContextPurge from "./process-context-purge.js";

type Approves = (
  args: unknown,
  ctx?: ActionRunContext,
) => boolean | Promise<boolean>;

const asks = (action: { needsApproval?: unknown }, args: unknown) => ({
  app: (action.needsApproval as Approves)(args, {
    caller: "tool",
  } as ActionRunContext),
  outside: (action.needsApproval as Approves)(args, {
    caller: "mcp",
  } as ActionRunContext),
});

describe("Creative Context actions outside agents run behind approval", () => {
  it.each([
    ["continue-context-import", continueContextImport, {}],
    ["process-context-purge", processContextPurge, {}],
    [
      "manage-context-membership",
      manageContextMembership,
      { operation: "approve" },
    ],
    [
      "manage-context-membership",
      manageContextMembership,
      { operation: "remove" },
    ],
    [
      "manage-creative-context",
      manageCreativeContext,
      { operation: "archive" },
    ],
    [
      "manage-creative-context",
      manageCreativeContext,
      { operation: "set-app-default" },
    ],
    ["manage-context-pack", manageContextPack, { operation: "archive" }],
  ] as const)(
    "%s asks only outside agents for %o",
    async (_name, action, args) => {
      expect(action.mcpTool).toBe("search");
      const { app, outside } = asks(action, args);
      expect(await app).toBe(false);
      expect(await outside).toBe(true);
    },
  );

  it.each([
    [
      "manage-context-membership",
      manageContextMembership,
      { operation: "submit" },
    ],
    [
      "manage-context-membership",
      manageContextMembership,
      { operation: "submit-latest" },
    ],
    ["manage-creative-context", manageCreativeContext, { operation: "create" }],
    ["manage-context-pack", manageContextPack, { operation: "create" }],
    ["manage-context-pack", manageContextPack, { operation: "derive" }],
    ["manage-context-pack", manageContextPack, { operation: "pin" }],
    ["manage-context-pack", manageContextPack, { operation: "unpin" }],
  ] as const)("%s runs %o without asking", async (_name, action, args) => {
    expect(await asks(action, args).outside).toBe(false);
  });
});
