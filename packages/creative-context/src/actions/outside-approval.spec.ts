import type { ActionRunContext } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

import continueContextImport from "./continue-context-import.js";
import manageContextMembership from "./manage-context-membership.js";
import manageContextPack from "./manage-context-pack.js";
import manageContextSource from "./manage-context-source.js";
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
    ["continue-context-import", {}, continueContextImport],
    ["process-context-purge", {}, processContextPurge],
    [
      "manage-context-membership",
      { operation: "submit" },
      manageContextMembership,
    ],
    [
      "manage-context-membership",
      { operation: "submit-latest" },
      manageContextMembership,
    ],
    [
      "manage-context-membership",
      { operation: "approve" },
      manageContextMembership,
    ],
    [
      "manage-context-membership",
      { operation: "remove" },
      manageContextMembership,
    ],
    [
      "manage-creative-context",
      { operation: "archive" },
      manageCreativeContext,
    ],
    [
      "manage-creative-context",
      { operation: "set-app-default" },
      manageCreativeContext,
    ],
    ["manage-context-pack", { operation: "archive" }, manageContextPack],
    ["manage-context-source", { operation: "archive" }, manageContextSource],
  ] as const)(
    "%s asks only outside agents for %o",
    async (_name, args, action) => {
      expect(action.mcpTool).toBe("search");
      const { app, outside } = asks(action, args);
      expect(await app).toBe(false);
      expect(await outside).toBe(true);
    },
  );

  it.each([
    ["manage-creative-context", { operation: "create" }, manageCreativeContext],
    ["manage-context-pack", { operation: "create" }, manageContextPack],
    ["manage-context-pack", { operation: "derive" }, manageContextPack],
    ["manage-context-pack", { operation: "pin" }, manageContextPack],
    ["manage-context-pack", { operation: "unpin" }, manageContextPack],
    ["manage-context-source", { operation: "update" }, manageContextSource],
    ["manage-context-source", { operation: "restore" }, manageContextSource],
  ] as const)("%s runs %o without asking", async (_name, args, action) => {
    expect(await asks(action, args).outside).toBe(false);
  });
});
