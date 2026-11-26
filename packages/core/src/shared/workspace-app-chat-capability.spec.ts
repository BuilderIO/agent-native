import { describe, expect, it } from "vitest";

import {
  WORKSPACE_APP_CHAT_SCOPE,
  WORKSPACE_APP_CHAT_TTL_SECONDS,
  isWorkspaceAppChatScope,
  workspaceAppChatAllowsRequest,
} from "./workspace-app-chat-capability.js";

const BASE = "/_agent-native/agent-chat";

describe("workspace app chat capability", () => {
  it("names its scope and lasts fifteen minutes", () => {
    expect(WORKSPACE_APP_CHAT_SCOPE).toBe("capability:workspace-app-chat");
    expect(WORKSPACE_APP_CHAT_TTL_SECONDS).toBe(900);
  });

  it.each([
    [WORKSPACE_APP_CHAT_SCOPE, true],
    ["capability:workspace-app-chat ", false],
    ["document", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("recognizes the scope %j as %s", (scope, expected) => {
    expect(isWorkspaceAppChatScope(scope)).toBe(expected);
  });

  it.each([
    ["POST", ""],
    ["GET", "/mode"],
    ["GET", "/capabilities"],
    ["GET", "/threads"],
    ["GET", "/runs/active"],
    ["GET", "/runs/latest"],
    ["GET", "/runs/list"],
    ["POST", "/threads"],
    ["GET", "/threads/t_1-A"],
    ["GET", "/threads/t_1-A/runs"],
    ["PUT", "/threads/t_1-A"],
    ["POST", "/threads/t1/queued"],
    ["POST", "/threads/t1/approval-resolution"],
    ["POST", "/threads/t1/rename"],
    ["POST", "/threads/t1/pin"],
    ["POST", "/threads/t1/hide"],
    ["POST", "/threads/t1/archive"],
    ["POST", "/threads/t1/fork"],
    ["GET", "/runs/r1/events"],
    ["GET", "/runs/r1/background-events"],
    ["POST", "/runs/r1/stop"],
    ["POST", "/runs/r1/abort"],
    ["POST", "/runs/turn/turn_1/abort"],
  ])("allows %s %s", (method, tail) => {
    expect(workspaceAppChatAllowsRequest(`${BASE}${tail}`, method)).toBe(true);
  });

  it.each([
    ["GET", ""],
    ["PUT", "/mode"],
    ["POST", "/mode"],
    ["DELETE", "/threads/t1"],
    ["POST", "/threads/t1"],
    ["GET", "/threads/t1/queued"],
    ["POST", "/threads/t1/share"],
    ["POST", "/threads/t1/rename/extra"],
    ["PUT", "/threads/t1/runs"],
    ["GET", "/threads/t.1"],
    ["GET", "/threads/"],
    ["GET", "/runs/r1/events/extra"],
    ["POST", "/runs/r1/events"],
    ["GET", "/runs/r1/stop"],
    ["POST", "/runs/turn/t1/stop"],
    ["POST", "/provider-keys"],
    ["POST", "/worker/dispatch"],
    ["GET", "/capabilitiesx"],
    ["POST", "/runs/list"],
    ["GET", "/runs/list/extra"],
  ])("refuses %s %s", (method, tail) => {
    expect(workspaceAppChatAllowsRequest(`${BASE}${tail}`, method)).toBe(false);
  });

  it("refuses paths outside the agent chat routes", () => {
    expect(workspaceAppChatAllowsRequest(`${BASE}x`, "POST")).toBe(false);
    expect(
      workspaceAppChatAllowsRequest("/_agent-native/actions", "POST"),
    ).toBe(false);
    expect(workspaceAppChatAllowsRequest(`/app${BASE}`, "POST")).toBe(false);
  });
});
