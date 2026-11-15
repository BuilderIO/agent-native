import { createApp } from "h3";
import { expect, it, vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";

vi.mock("../server/auth.js", async (original) => ({
  ...(await original<typeof import("../server/auth.js")>()),
  getBrowserCookieSession: async () => ({
    email: "actor@example.test",
    authUserId: "auth-test",
  }),
}));
vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: (app: unknown) => app,
}));
vi.mock("../server/ui-action-capability.js", () => ({
  hasUiActionCapability: () => true,
}));
vi.mock("../server/action-change.js", () => ({
  actionCallIsReadOnly: () => false,
  notifyActionChange: vi.fn(),
  notifyActionChangeForResponse: async () => true,
}));
import { mountActionRoutes } from "../server/action-routes.js";

it("recognizes the fixed private scope wire header before consuming credentials", async () => {
  const app = createApp();
  const run = vi.fn(async () => ({ saved: true }));
  const entry = {
    run,
    uiOnly: true,
    persistInChatHistory: false,
    agentTool: false,
    mcpTool: false,
    toolCallable: false,
  } as ActionEntry;
  mountActionRoutes(
    app,
    { "private-save": entry },
    {
      getOwnerFromEvent: async () => "actor@example.test",
      getAuthUserIdFromEvent: async () => "auth-test",
      resolveOrgId: async () => "org-current",
    },
  );
  const request = new Request(
    "https://example.test/_agent-native/actions/private-save",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "x-agent-native-frontend": "1",
        "X-Agent-Native-Private-Scope": JSON.stringify({
          email: "actor@example.test",
          orgId: "org-stale",
          authUserId: "auth-test",
        }),
      },
      body: JSON.stringify({ secret: "test-private-body" }),
    },
  );
  const response = await app.fetch(request);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Private action scope could not be confirmed.",
    errorCode: "private_action_scope_mismatch",
  });
  expect(request.bodyUsed).toBe(false);
  expect(run).not.toHaveBeenCalled();
});
